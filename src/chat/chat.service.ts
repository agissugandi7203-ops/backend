import { Injectable, Logger, HttpException, HttpStatus } from '@nestjs/common';
import { SupabaseService } from '../supabase/supabase.service';
import { OpenRouterService } from '../openrouter/openrouter.service';
import { ChatRequestDto } from './dto/chat-request.dto';

@Injectable()
export class ChatService {
  private readonly logger = new Logger(ChatService.name);

  constructor(
    private supabaseService: SupabaseService,
    private openRouterService: OpenRouterService,
  ) {}

  /**
   * Pemrosesan Chatbot RAG Standar (Respons Instan)
   */
  async processChat(dto: ChatRequestDto): Promise<{ reply: string }> {
    this.validatePayloadSizes(dto);
    const sanitizedMessage = this.sanitizeInput(dto.message);

    try {
      // 1. Cari konteks perda yang relevan dari database (RAG)
      const contextText = await this.retrieveContext(sanitizedMessage);

      // 2. Susun pesan instruksi sistem & multimodal content
      const messages = this.buildMultimodalMessages(sanitizedMessage, contextText, dto);

      // 3. Panggil OpenRouter
      const reply = await this.openRouterService.getChatCompletion(messages);
      return { reply };
    } catch (error) {
      this.logger.error(`Error processing instant chat: ${error.message}`);
      throw new HttpException(
        `Gagal memproses obrolan: ${error.message}`,
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  /**
   * Pemrosesan Chatbot RAG dengan Streaming (Server-Sent Events)
   */
  async processChatStream(dto: ChatRequestDto): Promise<Response> {
    this.validatePayloadSizes(dto);
    const sanitizedMessage = this.sanitizeInput(dto.message);

    try {
      // 1. Cari konteks perda dari database (RAG)
      const contextText = await this.retrieveContext(sanitizedMessage);

      // 2. Susun pesan instruksi sistem & multimodal content
      const messages = this.buildMultimodalMessages(sanitizedMessage, contextText, dto);

      // 3. Panggil OpenRouter Stream API
      return await this.openRouterService.getChatCompletionStream(messages);
    } catch (error) {
      this.logger.error(`Error starting chat stream: ${error.message}`);
      throw new HttpException(
        `Gagal memulai aliran data obrolan: ${error.message}`,
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  /**
   * Mengambil regulasi resmi kota dari database Supabase (Semantic Vector Search)
   */
  private async retrieveContext(query: string): Promise<string> {
    try {
      // Generate embedding dari kata kunci pencarian
      const queryEmbedding = await this.openRouterService.getEmbedding(query);

      const supabase = this.supabaseService.getClient();
      // Panggil fungsi RPC match_documents
      const { data: documents, error } = await supabase.rpc('match_documents', {
        query_embedding: queryEmbedding,
        match_threshold: 0.35, // Cocokkan regulasi dengan tingkat kemiripan min 35%
        match_count: 3,        // Ambil 3 dokumen perda paling relevan
      });

      if (error) {
        this.logger.error(`Error calling match_documents RPC: ${error.message}`);
        return '';
      }

      if (!documents || documents.length === 0) {
        return 'Tidak ditemukan peraturan perda khusus terkait topik ini.';
      }

      // Gabungkan isi konten perda menjadi teks utuh sebagai konteks LLM
      return documents
        .map((doc, idx) => `[Dokumen ${idx + 1}] Judul: ${doc.title}\nIsi: ${doc.content}`)
        .join('\n\n');
    } catch (err) {
      this.logger.error(`Failed to retrieve context from database: ${err.message}`);
      return 'Gagal memuat regulasi resmi kota dari database.';
    }
  }

  /**
   * Validasi ukuran berkas base64 agar tidak melebihi 5MB untuk mencegah DoS (Denial of Service)
   */
  private validatePayloadSizes(dto: ChatRequestDto) {
    const MAX_SIZE_BYTES = 5 * 1024 * 1024; // 5MB

    const checkSize = (base64Str: string | undefined, fieldName: string) => {
      if (!base64Str) return;
      
      // Hitung perkiraan ukuran byte dari panjang string base64
      // 4 karakter base64 setara dengan 3 byte data asli
      const sizeInBytes = (base64Str.length * 3) / 4;
      if (sizeInBytes > MAX_SIZE_BYTES) {
        throw new HttpException(
          `Ukuran lampiran berkas ${fieldName} terlalu besar. Maksimal ukuran berkas adalah 5MB.`,
          HttpStatus.BAD_REQUEST,
        );
      }
    };

    checkSize(dto.image, 'Gambar');
    checkSize(dto.pdf, 'PDF');
    checkSize(dto.audio, 'Suara/Audio');
  }

  /**
   * Mensanitasi input teks warga untuk mencegah Prompt Injection
   */
  private sanitizeInput(input: string): string {
    const dangerousPatterns = [
      /ignore previous instructions/i,
      /ignore system instructions/i,
      /ignore above/i,
      /system override/i,
      /forget everything/i,
      /forget rules/i,
      /bypass safety/i,
      /developer mode/i,
      /you are now/i,
    ];

    let sanitized = input;
    for (const pattern of dangerousPatterns) {
      if (pattern.test(sanitized)) {
        this.logger.warn(`Prompt Injection attempt detected and blocked: "${sanitized}"`);
        sanitized = sanitized.replace(pattern, '[REDACTED SYSTEM OVERRIDE ATTEMPT]');
      }
    }
    return sanitized;
  }

  /**
   * Menyusun payload pesan multimodal OpenRouter
   */
  private buildMultimodalMessages(userMessage: string, contextText: string, dto: ChatRequestDto): any[] {
    const systemPrompt = `
      Anda adalah Asisten Hukum & Peraturan Kota Genesis.id yang sangat sopan dan pintar.
      Tugas Anda adalah membantu warga menjawab pertanyaan mereka secara akurat, jelas, dan santun hanya berdasarkan konteks dokumen peraturan resmi yang disediakan di bawah ini.
      
      ATURAN JAWABAN:
      1. Jawab HANYA menggunakan informasi regulasi resmi yang disediakan. Jangan mengarang informasi di luar dokumen.
      2. Jika pertanyaan warga sama sekali tidak berhubungan dengan regulasi kota yang disediakan, katakan dengan sopan bahwa Anda tidak memiliki wewenang atau informasi perda mengenai hal tersebut, lalu sarankan mereka untuk menghubungi dinas terkait kota secara resmi.
      3. Hormati aturan tata krama penulisan bahasa Indonesia yang baik dan benar.

      DOKUMEN REGULASI RESMI KOTA (ACUAN RAG):
      ${contextText}
    `;

    const userContentArray: any[] = [
      { type: 'text', text: userMessage }
    ];

    // Lampirkan gambar jika ada
    if (dto.image) {
      const imageUrl = dto.image.startsWith('data:') 
        ? dto.image 
        : `data:image/jpeg;base64,${dto.image}`;
      userContentArray.push({
        type: 'image_url',
        image_url: { url: imageUrl }
      });
    }

    // Lampirkan PDF jika ada
    if (dto.pdf) {
      const pdfDataUrl = dto.pdf.startsWith('data:')
        ? dto.pdf
        : `data:application/pdf;base64,${dto.pdf}`;
      userContentArray.push({
        type: 'file',
        file: {
          filename: 'uploaded_document.pdf',
          file_data: pdfDataUrl
        }
      });
    }

    // Lampirkan Audio jika ada
    if (dto.audio) {
      let rawBase64 = dto.audio;
      let format = 'wav';
      
      // Jika dikirim sebagai data URL, pisahkan header dan datanya
      if (dto.audio.startsWith('data:')) {
        const parts = dto.audio.split(';base64,');
        rawBase64 = parts[1] || dto.audio;
        const mime = parts[0].replace('data:', '');
        format = mime.split('/')[1] || 'wav';
      }

      userContentArray.push({
        type: 'input_audio',
        input_audio: {
          data: rawBase64,
          format: format
        }
      });
    }

    return [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userContentArray }
    ];
  }
}
