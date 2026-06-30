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
  async processChat(dto: ChatRequestDto): Promise<{ reply: string; annotations?: Array<{ type: string; url_citation: { url: string; title: string; content?: string; start_index: number; end_index: number } }> }> {
    this.validatePayloadSizes(dto);
    const sanitizedMessage = this.sanitizeInput(dto.message);

    try {
       // 1. Cari konteks perda yang relevan dari database (RAG)
      const contextText = await this.retrieveContext(sanitizedMessage);

      // 2. Susun pesan instruksi sistem & multimodal content
      const messages = this.buildMultimodalMessages(
        sanitizedMessage,
        contextText,
        dto,
      );

      // 3. Panggil OpenRouter
      const result = await this.openRouterService.getChatCompletion(
        messages,
        dto.model,
        dto.webSearch,
      );
      return { reply: result.content, annotations: result.annotations };
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
      const messages = this.buildMultimodalMessages(
        sanitizedMessage,
        contextText,
        dto,
      );

      // 3. Panggil OpenRouter Stream API
      return await this.openRouterService.getChatCompletionStream(
        messages,
        dto.model,
        dto.webSearch,
      );
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
        match_count: 3, // Ambil 3 dokumen perda paling relevan
      });

      if (error) {
        this.logger.error(
          `Error calling match_documents RPC: ${error.message}`,
        );
        return '';
      }

      if (!documents || documents.length === 0) {
        return 'Tidak ditemukan peraturan perda khusus terkait topik ini.';
      }

      // Gabungkan isi konten perda menjadi teks utuh sebagai konteks LLM
      return documents
        .map(
          (doc, idx) =>
            `[Dokumen ${idx + 1}] Judul: ${doc.title}\nIsi: ${doc.content}`,
        )
        .join('\n\n');
    } catch (err) {
      this.logger.error(
        `Failed to retrieve context from database: ${err.message}`,
      );
      return 'Gagal memuat regulasi resmi kota dari database.';
    }
  }

  /**
   * Validasi ukuran berkas base64 agar tidak melebihi 10MB untuk mencegah DoS (Denial of Service)
   */
  private validatePayloadSizes(dto: ChatRequestDto) {
    const MAX_SIZE_BYTES = 10 * 1024 * 1024; // 10MB

    const checkSize = (base64Str: string | undefined, fieldName: string) => {
      if (!base64Str) return;

      // Hitung perkiraan ukuran byte dari panjang string base64
      // 4 karakter base64 setara dengan 3 byte data asli
      const sizeInBytes = (base64Str.length * 3) / 4;
      if (sizeInBytes > MAX_SIZE_BYTES) {
        throw new HttpException(
          `Ukuran lampiran berkas ${fieldName} terlalu besar. Maksimal ukuran berkas adalah 10MB.`,
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
    if (!input) return input;

    let sanitized = input;

    // Pola Deteksi Prompt Injection (termasuk Typoglycemia / Fuzzy target words)
    const dangerousPatterns = [
      // Standar
      /ignore\s+previous\s+instructions/i,
      /ignore\s+system\s+instructions/i,
      /ignore\s+above/i,
      /system\s+override/i,
      /forget\s+everything/i,
      /forget\s+rules/i,
      /bypass\s+safety/i,
      /developer\s+mode/i,
      /you\s+are\s+now/i,

      // Typoglycemia (Fuzzy targets)
      /ign(?:ore|roe|onre|ore)\s+prev(?:ious|ous|oius)\s+inst(?:ructions|uctions|rucions|rutions)/i,
      /ign(?:ore|roe|onre|ore)\s+syst(?:em|me|estm|em)\s+inst(?:ructions|uctions|rucions|rutions)/i,
      /ign(?:ore|roe|onre|ore)\s+above/i,
      /syst(?:em|me|estm|em)\s+overr?(?:ide|de|ide)/i,
      /forg(?:et|t|egt|ret)\s+every(?:thing|thing)/i,
      /forg(?:et|t|egt|ret)\s+ru(?:les|els|ls|lse)/i,
      /bypas{1,2}\s+saf(?:ety|tey)/i,
      /dev(?:eloper|loper)\s+mode/i,
    ];

    // 1. Cek & Redact Space-separated Hex Pairs (e.g. "69 67 6e 6f 72 65")
    const spaceHexRegex = /\b([0-9a-fA-F]{2}\s+)+[0-9a-fA-F]{2}\b/g;
    sanitized = sanitized.replace(spaceHexRegex, (match) => {
      try {
        const hexes = match.split(/\s+/);
        const decoded = Buffer.from(hexes.map((h) => parseInt(h, 16))).toString(
          'utf-8',
        );
        if (/^[\x20-\x7E\r\n\t]+$/.test(decoded)) {
          for (const pattern of dangerousPatterns) {
            if (pattern.test(decoded)) {
              this.logger.warn(
                `Prompt Injection (Hex Evasion) detected and redacted.`,
              );
              return '[PROMPT_INJECTION]';
            }
          }
        }
      } catch (_) {}
      return match;
    });

    // 2. Cek & Redact Continuous Hex String (e.g. "69676e6f7265")
    const continuousHexRegex = /\b[0-9a-fA-F]{8,}\b/g;
    sanitized = sanitized.replace(continuousHexRegex, (match) => {
      if (match.length % 2 === 0) {
        try {
          const decoded = Buffer.from(match, 'hex').toString('utf-8');
          if (/^[\x20-\x7E\r\n\t]+$/.test(decoded)) {
            for (const pattern of dangerousPatterns) {
              if (pattern.test(decoded)) {
                this.logger.warn(
                  `Prompt Injection (Hex Evasion) detected and redacted.`,
                );
                return '[PROMPT_INJECTION]';
              }
            }
          }
        } catch (_) {}
      }
      return match;
    });

    // 3. Cek & Redact Base64 (e.g. "aWdub3JlIHByZXZpb3Vz")
    const base64Regex = /\b[a-zA-Z0-9+/]{8,}=*\b/g;
    sanitized = sanitized.replace(base64Regex, (match) => {
      try {
        const decoded = Buffer.from(match, 'base64').toString('utf-8');
        if (/^[\x20-\x7E\r\n\t]+$/.test(decoded)) {
          for (const pattern of dangerousPatterns) {
            if (pattern.test(decoded)) {
              this.logger.warn(
                `Prompt Injection (Base64 Evasion) detected and redacted.`,
              );
              return '[PROMPT_INJECTION]';
            }
          }
        }
      } catch (_) {}
      return match;
    });

    // 4. Cek & Redact Spaced Characters (e.g. "i g n o r e  p r e v i o u s")
    const spacedCharRegex = /(?:\b[a-zA-Z]\s+)+[a-zA-Z]\b/g;
    sanitized = sanitized.replace(spacedCharRegex, (match) => {
      const collapsed = match.replace(/\s+/g, '');
      for (const pattern of dangerousPatterns) {
        if (pattern.test(collapsed)) {
          this.logger.warn(
            `Prompt Injection (Character Spacing Evasion) detected and redacted.`,
          );
          return '[PROMPT_INJECTION]';
        }
      }
      return match;
    });

    // 5. Cek & Redact standard/typoglycemia patterns directly on the sanitized string
    for (const pattern of dangerousPatterns) {
      if (pattern.test(sanitized)) {
        this.logger.warn(`Prompt Injection detected and redacted.`);
        sanitized = sanitized.replace(pattern, '[PROMPT_INJECTION]');
      }
    }

    return sanitized;
  }

  /**
   * Menyusun payload pesan multimodal OpenRouter
   */
  private buildMultimodalMessages(
    userMessage: string,
    contextText: string,
    dto: ChatRequestDto,
  ): any[] {
    const now = new Date();
    const dateOptions: Intl.DateTimeFormatOptions = {
      weekday: 'long',
      year: 'numeric',
      month: 'long',
      day: 'numeric',
      timeZone: 'Asia/Jakarta',
    };
    const timeOptions: Intl.DateTimeFormatOptions = {
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hour12: false,
      timeZone: 'Asia/Jakarta',
    };
    const currentIndonesianDate = now.toLocaleDateString('id-ID', dateOptions);
    const currentIndonesianTime = now.toLocaleTimeString('id-ID', timeOptions);

    const webSearchGuideline = dto.webSearch
      ? `\n      - STATUS PENCARIAN WEB: AKTIF. Sistem telah secara otomatis melakukan pencarian web dan menyisipkan hasil pencarian terkini ke dalam konteks percakapan ini. Gunakan HANYA data dari hasil pencarian web tersebut untuk menjawab pertanyaan yang membutuhkan informasi terkini (berita, peristiwa, data ${now.getFullYear()}, dll). JANGAN mengarang fakta. Jika hasil pencarian tidak memuat jawaban, katakan secara jujur bahwa data belum tersedia di hasil pencarian. Selalu sertakan sumber kutipan sebagai tautan markdown.`
      : '';

    const systemPrompt = `
      Anda adalah Asisten Hukum & Peraturan Kota Genesis bernama Geni. Anda sangat ramah, hangat, menyambut, interaktif, dan cerdas.
      Tugas utama Anda adalah membantu warga memahami peraturan kota dengan sapaan hangat di awal pesan, lalu menyajikan penjelasan yang jelas, padat, dan tidak kaku (bersahabat).

      INFORMASI WAKTU NYATA & KETENTUAN SANGAT KRUSIAL:
      - Tanggal & Waktu Saat Ini: ${currentIndonesianDate}, pukul ${currentIndonesianTime} WIB. Semua rujukan "saat ini", "sekarang", "hari ini", "jam berapa", atau tahun berjalan WAJIB mengacu pada waktu tersebut secara tepat. JANGAN PERNAH mengarang atau menebak tanggal/waktu lain.${webSearchGuideline}

      PANDUAN RESPONS:
      1. MENYAMBUT & RAMAH: Mulailah pesan dengan sapaan hangat yang interaktif, seperti "Halo Kak! 👋" atau "Selamat datang di Genesis! 😊" atau "Senang bisa membantu Anda! 🌱". Buat warga merasa diterima dan didengarkan.
      2. CEPAT & TO-THE-POINT: Sajikan jawaban secara padat, efektif, dan langsung menjawab inti pertanyaan (to-the-point) demi mempercepat waktu respons (latensi rendah). Hindari kalimat hukum yang berbelit-belit dan kaku.
      3. STRUKTUR MARKDOWN INDAH: Susun jawaban Anda menggunakan format Markdown yang rapi dan terstruktur (tebal, miring, daftar poin, kutipan, bahkan tabel sederhana jika membandingkan data) agar sangat mudah dipahami warga secara instan di layar HP mereka.
      4. GENTLE DEFLECTION (PENGALIHAN RAMAH): Jika warga menanyakan hal di luar topik regulasi resmi atau di luar konteks kota, JANGAN PERNAH menolak langsung secara kasar atau kaku (seperti "Saya tidak bisa menjawab itu" atau "Maaf saya hanya diprogram untuk..."). Sebaliknya, jawablah dengan mengaitkan pertanyaan tersebut secara kreatif dan santun ke konteks aturan lingkungan, kenyamanan hidup warga, kebersihan kota, atau ketertiban umum. Berikan jembatan kalimat pengalihan yang mulus, misalnya mengarahkan mereka untuk memeriksa regulasi kota terkait atau menyarankan langkah positif sebagai warga yang baik. Jaga agar percakapan tetap mengalir hangat dan mendidik!

      DOKUMEN REGULASI RESMI KOTA (ACUAN RAG):
      ${contextText}
    `;

    const messages: any[] = [];
    messages.push({ role: 'system', content: systemPrompt });

    // Prepend chat history (up to last 10 messages to avoid token bloating)
    if (dto.history && dto.history.length > 0) {
      const limitedHistory = dto.history.slice(-10);
      for (const h of limitedHistory) {
        messages.push({
          role: h.sender === 'user' ? 'user' : 'assistant',
          content: h.message,
        });
      }
    }

    const userContentArray: any[] = [{ type: 'text', text: userMessage }];

    // Lampirkan gambar jika ada
    if (dto.image) {
      const imageUrl = dto.image.startsWith('data:')
        ? dto.image
        : `data:image/jpeg;base64,${dto.image}`;
      userContentArray.push({
        type: 'image_url',
        image_url: { url: imageUrl },
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
          file_data: pdfDataUrl,
        },
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
          format: format,
        },
      });
    }

    messages.push({ role: 'user', content: userContentArray });

    return messages;
  }

  /**
   * Transkripsi audio menggunakan OpenRouter Speech-To-Text API
   */
  async transcribeAudio(
    base64Audio: string,
    format: string,
    model?: string,
  ): Promise<{ text: string }> {
    if (!base64Audio) {
      throw new HttpException(
        'Audio data (base64) wajib disertakan',
        HttpStatus.BAD_REQUEST,
      );
    }

    try {
      let rawBase64 = base64Audio;
      let audioFormat = format || 'wav';

      // Jika dikirim sebagai data URL, pisahkan header dan datanya
      if (base64Audio.startsWith('data:')) {
        const parts = base64Audio.split(';base64,');
        rawBase64 = parts[1] || base64Audio;
        const mime = parts[0].replace('data:', '');
        audioFormat = mime.split('/')[1] || audioFormat;
      }

      const text = await this.openRouterService.transcribeAudio(
        rawBase64,
        audioFormat,
        model,
      );
      return { text };
    } catch (error) {
      this.logger.error(`Error in transcribeAudio service: ${error.message}`);
      throw new HttpException(
        `Gagal mentranskripsi audio: ${error.message}`,
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }
}
