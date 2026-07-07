import { Injectable, Logger, HttpException, HttpStatus } from '@nestjs/common';
import { SupabaseService } from '../supabase/supabase.service';
import { OpenRouterService } from '../openrouter/openrouter.service';
import { ChatRequestDto } from './dto/chat-request.dto';

@Injectable()
export class ChatService {
  private readonly logger = new Logger(ChatService.name);
  private readonly embeddingCache = new Map<string, number[]>();

  constructor(
    private supabaseService: SupabaseService,
    private openRouterService: OpenRouterService,
  ) {}

  /**
   * Mengambil data profil singkat warga untuk info level/XP secara dinamis
   */
  private async getUserProfileBrief(userId?: string): Promise<{ level: number; xp: number; full_name?: string } | null> {
    if (!userId) return null;
    try {
      const supabase = this.supabaseService.getClient();
      const { data, error } = await supabase
        .from('profiles')
        .select('level, xp, full_name')
        .eq('id', userId)
        .maybeSingle();

      if (error || !data) return null;
      return {
        level: data.level ?? 1,
        xp: data.xp ?? 0,
        full_name: data.full_name || '',
      };
    } catch (err) {
      // Anti silent-catch: catat error agar dapat ditelusuri (profil bersifat opsional,
      // jadi request tetap dilanjutkan tanpa data profil)
      this.logger.warn(
        `Gagal mengambil profil singkat user ${userId}: ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
      return null;
    }
  }

  /**
   * Helper untuk mendeteksi kueri bermuatan regulasi perda
   */
  private isRegulationQuery(message: string): boolean {
    if (!message) return false;
    const keywords = ['perda', 'peraturan', 'denda', 'sanksi', 'hukum', 'pasal', 'undang', 'legal', 'regulasi'];
    const lowerMessage = message.toLowerCase();
    return keywords.some(kw => lowerMessage.includes(kw));
  }

  /**
   * Pemrosesan Chatbot RAG Standar (Respons Instan)
   */
  async processChat(dto: ChatRequestDto, userId?: string): Promise<{ reply: string; annotations?: Array<{ type: string; url_citation: { url: string; title: string; content?: string; start_index: number; end_index: number } }> }> {
    this.validatePayloadSizes(dto);
    const sanitizedMessage = this.sanitizeInput(dto.message);

    try {
      // 1. Ambil data profil singkat warga
      const userProfile = await this.getUserProfileBrief(userId);

      // 2. Tentukan penggunaan Vertex AI Search RAG (Grounding) atau Supabase RAG lokal
      const isGreeting = this.isChitChat(sanitizedMessage);
      const isRegulation = this.isRegulationQuery(sanitizedMessage);
      
      const datastoreId = process.env.VERTEX_AI_DATASTORE_ID;
      const useRAG = !!datastoreId && !isGreeting && isRegulation && !dto.webSearch;
      
      // Jika menggunakan Vertex AI Search, kita lewati query database lokal Supabase
      const shouldSearchDB = !useRAG && !isGreeting && (isRegulation || !dto.webSearch);

      const contextText = shouldSearchDB
        ? await this.retrieveContext(sanitizedMessage)
        : '';

      // 3. Susun pesan instruksi sistem & multimodal content
      const messages = this.buildMultimodalMessages(
        sanitizedMessage,
        contextText,
        dto,
        userProfile,
      );

      // 4. Panggil OpenRouter / Vertex AI
      const result = await this.openRouterService.getChatCompletion(
        messages,
        dto.model,
        dto.webSearch,
        userId,
        undefined,
        useRAG,
      );
      return { reply: result.content, annotations: result.annotations };
    } catch (error) {
      const errMsg = error instanceof Error ? error.message : String(error);
      this.logger.error(`Error processing instant chat: ${errMsg}`);
      throw new HttpException(
        `Gagal memproses obrolan: ${errMsg}`,
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  /**
   * Pemrosesan Chatbot RAG dengan Streaming (Server-Sent Events)
   */
  async processChatStream(dto: ChatRequestDto, userId?: string): Promise<Response> {
    this.validatePayloadSizes(dto);
    const sanitizedMessage = this.sanitizeInput(dto.message);

    try {
      // 1. Ambil data profil singkat warga
      const userProfile = await this.getUserProfileBrief(userId);

      // 2. Tentukan penggunaan Vertex AI Search RAG (Grounding) atau Supabase RAG lokal
      const isGreeting = this.isChitChat(sanitizedMessage);
      const isRegulation = this.isRegulationQuery(sanitizedMessage);
      
      const datastoreId = process.env.VERTEX_AI_DATASTORE_ID;
      const useRAG = !!datastoreId && !isGreeting && isRegulation && !dto.webSearch;
      
      // Jika menggunakan Vertex AI Search, kita lewati query database lokal Supabase
      const shouldSearchDB = !useRAG && !isGreeting && (isRegulation || !dto.webSearch);

      const contextText = shouldSearchDB
        ? await this.retrieveContext(sanitizedMessage)
        : '';

      // 3. Susun pesan instruksi sistem & multimodal content
      const messages = this.buildMultimodalMessages(
        sanitizedMessage,
        contextText,
        dto,
        userProfile,
      );

      // 4. Panggil OpenRouter / Vertex AI Stream API
      return await this.openRouterService.getChatCompletionStream(
        messages,
        dto.model,
        dto.webSearch,
        userId,
        undefined,
        useRAG,
      );
    } catch (error) {
      const errMsg = error instanceof Error ? error.message : String(error);
      this.logger.error(`Error starting chat stream: ${errMsg}`);
      throw new HttpException(
        `Gagal memulai aliran data obrolan: ${errMsg}`,
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  /**
   * Mengambil regulasi resmi kota dari database Supabase (Semantic Vector Search)
   */
  private async retrieveContext(query: string): Promise<string> {
    try {
      // Generate/read embedding dari cache
      let queryEmbedding: number[];
      if (this.embeddingCache.has(query)) {
        queryEmbedding = this.embeddingCache.get(query)!;
        this.logger.log(`Menggunakan cached embedding untuk query: "${query}"`);
      } else {
        queryEmbedding = await this.openRouterService.getEmbedding(query);
        // Jaga kapasitas cache maksimal 100 entri untuk menghindari memory leaks
        if (this.embeddingCache.size >= 100) {
          const firstKey = this.embeddingCache.keys().next().value;
          if (firstKey) this.embeddingCache.delete(firstKey);
        }
        this.embeddingCache.set(query, queryEmbedding);
      }

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
        `Failed to retrieve context from database: ${
          err instanceof Error ? err.message : String(err)
        }`,
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
   * Mendeteksi apakah pesan dari user merupakan basa-basi/sapaan umum (Chit-Chat)
   */
  private isChitChat(message: string): boolean {
    if (!message) return true;
    // Hapus spasi di awal/akhir, ubah ke lowercase, dan buang semua tanda baca
    const cleanMessage = message.trim().toLowerCase().replace(/[.,\/#!$%\^&\*;:{}=\-_`~()?]/g, "");

    // 1. Jika pesan sangat pendek (di bawah 3 kata dan kurang dari 12 karakter setelah dibersihkan)
    const words = cleanMessage.split(/\s+/).filter(w => w.length > 0);
    if (words.length < 3 && cleanMessage.length < 12) {
      return true;
    }

    // 2. Daftar kata sapaan/basa-basi umum bahasa Indonesia dan Inggris (Wajib tepat cocok dari awal sampai akhir)
    const chitChatPatterns = /^(halo|hi|hey|pagi|siang|sore|malam|assalamualaikum|shaluom|shalom|permisi|tes|test|ok|oke|siap|nuhun|suwun|terima kasih|thanks|thank you|bye|dadah|halo geni|hello geni)$/i;
    
    return chitChatPatterns.test(cleanMessage);
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
  /**
   * Menyusun payload pesan multimodal OpenRouter
   */
  private buildMultimodalMessages(
    userMessage: string,
    contextText: string,
    dto: ChatRequestDto,
    userProfile?: { level: number; xp: number; full_name?: string } | null,
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
      ? `\n      - STATUS PENCARIAN WEB: AKTIF. Hasil pencarian web otomatis disisipkan ke sistem Anda. Gunakan data tersebut untuk menjawab pertanyaan terkini (berita, tahun ${now.getFullYear()}, dll) secara akurat. Jawablah secara natural, padat, dan informatif.`
      : '';

    const turnCount = (dto.history?.length || 0) + 1;

    const profileContext = userProfile
      ? `\n      - PROFIL WARGA AKTIF: Nama: ${userProfile.full_name || 'Warga'}, Level: ${userProfile.level}, XP: ${userProfile.xp}.`
      : '';

    const turnContext = turnCount === 1
      ? `\n      - FASE PERCAKAPAN: Turn 1. Sapa pengguna secara hangat, ramah, dan sopan di awal kalimat pertama.`
      : `\n      - FASE PERCAKAPAN: Turn ${turnCount}. JANGAN gunakan kalimat pembuka basa-basi atau sapaan (seperti "Halo Kak", "Selamat pagi/siang/sore", "Terima kasih", "Berdasarkan hasil...", dll). Langsung jawab pertanyaan pengguna secara to-the-point pada kalimat pertama.`;

    const levelToneInstruction = userProfile && userProfile.level >= 5
      ? `\n      - ATURAN NADA: Warga ini adalah Pahlawan Lingkungan Kota (Level >= 5). Sapa mereka dengan sebutan hormat "Pahlawan ${userProfile.full_name || 'Warga'}" atau "Kak Pahlawan ${userProfile.full_name || 'Warga'}" di turn pertama percakapan, dan apresiasi kontribusi besar mereka bagi kota secara santun.`
      : `\n      - ATURAN NADA: Sapa pengguna secara ramah dengan "Kak" atau "Kakak".`;

    const systemPrompt = `
      Anda adalah Asisten Hukum & Peraturan Kota Genesis bernama Geni. Anda sangat ramah, hangat, menyambut, interaktif, dan cerdas.
      Tugas utama Anda adalah membantu warga memahami peraturan kota dengan sapaan hangat di awal pesan, lalu menyajikan penjelasan yang jelas, padat, dan tidak kaku (bersahabat).

      PROYEK & TIM PENGEMBANG (KREDIT):
      - Platform cerdas Genesis.id dan asisten AI Geni ini dikembangkan dengan bangga oleh tim hebat dari SMK Marhas Margahayu yang terdiri dari:
        1. Arief Fajar (Lead Developer)
        2. Reza Arrofi (UI/UX & Frontend Developer)
        3. Alysia Fasma Nidai (Technical Writer & QA)
      - Proyek ini dirancang dan dibangun khusus sebagai solusi inovatif dalam ajang kompetisi LKS Nasional (Lomba Kompetensi Siswa Nasional).
      - Jika warga bertanya tentang siapa pembuat Anda, sejarah pembuatan Anda, siapa tim di balik Geni, asal-usul Anda, atau info sekolah pengembang, jawablah dengan sangat bangga, sopan, dan sebutkan nama-nama anggota tim pengembang serta nama sekolah SMK Marhas Margahayu di atas secara ramah dan natural.

      INFORMASI WAKTU NYATA (SILENT REFERENCE):
      - Tanggal & Waktu Saat Ini: ${currentIndonesianDate}, pukul ${currentIndonesianTime} WIB.
      - **PENTING**: Informasi waktu ini disediakan HANYA sebagai acuan internal Anda untuk menjawab jika warga bertanya hal-hal yang berkaitan dengan waktu (seperti jadwal pembuangan sampah, tanggal hari lahir kota, jadwal pelayanan dinas, dll). 
      - **Batas Keras**: JANGAN PERNAH menyertakan, mengulang-ngulang, atau menginfokan tanggal & waktu saat ini di awal sapaan atau di pesan Anda kecuali ditanyakan secara eksplisit oleh warga! Ini membuat sapaan terkesan aneh dan tidak natural.
      ${profileContext}${turnContext}${levelToneInstruction}

      PANDUAN RESPONS & PERSONA (LEBIH TERLATIH & SINGKAT):
      1. JAWABAN TO-THE-POINT (CONCISE): Langsung sajikan jawaban inti yang dicari warga secara padat dan efektif. Batasi panjang keseluruhan jawaban Anda maksimal **2-3 paragraf pendek** atau gunakan daftar poin (bullet points) jika membandingkan data. Hindari kalimat penjelasan yang berputar-putar.
      2. FORMAT DRAF/SURAT/EMAIL: Jika warga meminta Anda untuk membuat draf email, surat formal, draf laporan pengaduan, atau template tulisan resmi lainnya, Anda WAJIB membungkus murni teks draf tersebut di dalam block code markdown dengan bahasa 'draft'. Contoh:
         \`\`\`draft
         Kepada Yth. Kepala Dinas...
         Isi draf...
         \`\`\`
         JANGAN menulis kalimat pembuka atau penutup obrolan Anda di dalam blok code 'draft' tersebut.
      3. HINDARI FRASA TEMPLATE AI (NO FILLERS): JANGAN gunakan frasa template AI chatbot yang membosankan dan repetitif seperti "Ada hal lain yang bisa saya bantu?", "Jangan ragu untuk bertanya lagi!", "Senang menyapa Anda!", atau "Sebagai asisten yang siap membantu...". Cukup akhiri kalimat secara menjaga alur percakapan yang natural tanpa kalimat penutup template yang dipaksakan.
      4. STRUKTUR MARKDOWN INDAH: Susun jawaban Anda menggunakan format Markdown yang rapi (tebal, miring, daftar poin, kutipan, bahkan tabel sederhana jika membandingkan data).
      5. FITUR PANGGIL GAMBAR (VISUAL CALLING): JANGAN PERNAH menyisipkan gambar/foto di dalam chat menggunakan format markdown \`![deskripsi](URL)\` kecuali pengguna secara eksplisit meminta contoh visual/gambar (seperti "tunjukkan gambar...", "bagaimana foto..."). Jika diminta, gunakan HANYA link gambar terpercaya berikut:
         - Contoh Sampah Organik: https://images.unsplash.com/photo-1542601906990-b4d3fb778b09?w=500 (daur ulang/kompos)
         - Contoh Sampah Anorganik: https://images.unsplash.com/photo-1611284446314-60a58ac0deb9?w=500 (botol plastik)
         - Panduan Genesis: https://images.unsplash.com/photo-1532996122724-e3c354a0b15b?w=500 (taman kota bersih)
         JANGAN mengarang link acak yang tidak valid atau mati.
      6. TOMBOL NAVIGASI INTERAKTIF (NAVIGATION BUTTONS): Jika warga bertanya tentang cara melakukan tindakan di aplikasi (seperti melapor sampah, melihat leaderboard, menukar hadiah, profil), Anda WAJIB menyisipkan blok kode navigasi khusus di akhir respons Anda:
         \`\`\`navigation
         label: [Nama Tombol Tindakan]
         route: [Route Halaman]
         icon: [Ikon yang cocok: camera / trophy / gift / person]
         \`\`\`
         Gunakan route berikut yang terdaftar di aplikasi:
         - Formulir Laporan Sampah Baru: /reports/create (ikon: camera)
         - Leaderboard Warga: /leaderboard (ikon: trophy)
         - Tukar Poin / Hadiah: /rewards (ikon: gift)
         - Profil & Badges Warga: /profile (ikon: person)
         JANGAN menulis kalimat pembuka atau penutup di dalam blok 'navigation' tersebut.
      7. GENTLE DEFLECTION (PENGALIHAN RAMAH): Jika warga menanyakan hal di luar topik regulasi resmi atau di luar konteks kota, JANGAN PERNAH menolak langsung secara kasar atau kaku. Sebaliknya, hubungkan secara kreatif dan santun ke konteks aturan lingkungan, kenyamanan hidup warga, kebersihan kota, atau ketertiban umum.

      KETENTUAN RAG (PENCARIAN DOKUMEN):
      - Jika ada isi di bagian "DOKUMEN REGULASI RESMI KOTA", gunakan informasi tersebut sebagai acuan utama Anda dalam menjawab pertanyaan warga seputar hukum.
      - Jika bagian "DOKUMEN REGULASI RESMI KOTA" kosong (karena warga hanya menyapa/basa-basi), jawablah secara ramah dan singkat serta ajak mereka untuk bertanya seputar aturan kota atau pelaporan masalah lingkungan. JANGAN mengarang-ngarang nomor perda atau pasal hukum jika tidak ada di dokumen acuan.

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
      const errMsg = error instanceof Error ? error.message : String(error);
      this.logger.error(`Error in transcribeAudio service: ${errMsg}`);
      throw new HttpException(
        `Gagal mentranskripsi audio: ${errMsg}`,
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }
}
