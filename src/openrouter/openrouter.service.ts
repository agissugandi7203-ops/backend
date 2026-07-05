import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { GoogleGenAI } from '@google/genai';
import * as fs from 'fs';
import { SupabaseService } from '../supabase/supabase.service';

@Injectable()
export class OpenRouterService {
  private readonly logger = new Logger(OpenRouterService.name);
  private readonly ai: GoogleGenAI;
  private readonly defaultModel: string;
  private readonly embeddingModel: string;

  constructor(
    private configService: ConfigService,
    private supabaseService: SupabaseService,
  ) {
    const projectId = this.configService.get<string>('GCS_PROJECT_ID') || 'arief-fajar';
    const keyFilePath = this.configService.get<string>('GCS_KEY_FILE_PATH');

    // Set credentials for Google GenAI SDK if key file path is provided and exists on disk
    if (keyFilePath && fs.existsSync(keyFilePath)) {
      process.env.GOOGLE_APPLICATION_CREDENTIALS = keyFilePath;
      this.logger.log(`Using credentials keyfile: ${keyFilePath}`);
    } else {
      this.logger.log('Key file not found on disk. Falling back to Application Default Credentials (ADC) or GCP Metadata IAM.');
    }

    const region = this.configService.get<string>('VERTEX_AI_REGION') || 'asia-southeast1';

    try {
      this.ai = new GoogleGenAI({
        vertexai: true,
        project: projectId,
        location: region,
      });
      this.logger.log(`Google GenAI (Vertex AI) Client initialized successfully targeting ${region}.`);
    } catch (err) {
      this.logger.error(`Failed to initialize Google GenAI Client: ${err.message}`);
    }

    // Default to Gemini 2.5 Flash and automatically strip "google/" or "openai/" prefix if present
    const rawModel = this.configService.get<string>('OPENROUTER_MODEL') || 'gemini-2.5-flash';
    this.defaultModel = rawModel.replace(/^(google\/|openai\/)/i, '');
    
    // Default to text-embedding-004 and strip prefix
    const rawEmbedModel = this.configService.get<string>('OPENROUTER_EMBEDDING_MODEL') || 'text-embedding-004';
    let cleanEmbed = rawEmbedModel.replace(/^(google\/|openai\/)/i, '');
    if (cleanEmbed.includes('gemini-embedding')) {
      cleanEmbed = 'text-embedding-004';
    }
    this.embeddingModel = cleanEmbed;
  }

  /**
   * Mendeteksi dan memetakan pesan berformat OpenAI ke format input Google GenAI (Gemini)
   */
  private mapOpenAiToGemini(messages: any[]): { contents: any[]; systemInstruction?: string } {
    let systemInstruction: string | undefined;
    const contents: any[] = [];

    for (const msg of messages) {
      if (msg.role === 'system') {
        systemInstruction = msg.content;
        continue;
      }

      if (msg.role === 'tool') {
        contents.push({
          role: 'tool',
          parts: [{
            functionResponse: {
              name: msg.name,
              response: msg.response,
            }
          }]
        });
        continue;
      }

      if (msg.role === 'assistant' && msg.functionCall) {
        contents.push({
          role: 'model',
          parts: [{ functionCall: msg.functionCall }]
        });
        continue;
      }

      const role = msg.role === 'assistant' ? 'model' : 'user';
      const parts: any[] = [];

      if (typeof msg.content === 'string') {
        if (msg.content.length > 0) {
          parts.push({ text: msg.content });
        }
      } else if (Array.isArray(msg.content)) {
        for (const item of msg.content) {
          if (item.type === 'text') {
            parts.push({ text: item.text });
          } else if (item.type === 'image_url' && item.image_url?.url) {
            const url = item.image_url.url;
            const match = url.match(/^data:([^;]+);base64,(.+)$/);
            if (match) {
              parts.push({
                inlineData: {
                  mimeType: match[1],
                  data: match[2],
                },
              });
            } else {
              parts.push({ text: `[Gambar: ${url}]` });
            }
          } else if (item.type === 'file' && item.file?.file_data) {
            const fileData = item.file.file_data;
            const match = fileData.match(/^data:([^;]+);base64,(.+)$/);
            if (match) {
              parts.push({
                inlineData: {
                  mimeType: match[1],
                  data: match[2],
                },
              });
            }
          } else if (item.type === 'input_audio' && item.input_audio?.data) {
            const audioBase64 = item.input_audio.data;
            const format = item.input_audio.format || 'wav';
            parts.push({
              inlineData: {
                mimeType: format === 'mp3' ? 'audio/mp3' : `audio/${format}`,
                data: audioBase64,
              },
            });
          }
        }
      }

      if (parts.length > 0) {
        contents.push({ role, parts });
      }
    }

    return { contents, systemInstruction };
  }

  /**
   * Mendapatkan array embedding vektor untuk teks input (Menggunakan text-embedding-004)
   */
  async getEmbedding(text: string): Promise<number[]> {
    try {
      const response = await this.ai.models.embedContent({
        model: this.embeddingModel,
        contents: text,
      });

      const embedding = response.embeddings?.[0]?.values;
      if (!embedding || !Array.isArray(embedding)) {
        throw new Error('Invalid embedding response format from Vertex AI');
      }

      return embedding;
    } catch (error) {
      this.logger.error(`Error generating embedding: ${error.message}`);
      throw error;
    }
  }

  /**
   * Mengirim request chat completion dengan streaming (Dibungkus agar kompatibel dengan SSE OpenAI/OpenRouter)
   */
  /**
   * Mengirim request chat completion dengan streaming (Dibungkus agar kompatibel dengan SSE OpenAI/OpenRouter)
   */
  async getChatCompletionStream(
    messages: any[],
    model?: string,
    webSearch?: boolean,
    userId?: string,
  ): Promise<Response> {
    try {
      // Jika model dari client adalah flash (atau tidak ada), gunakan defaultModel dari .env (misal gemini-3.5-flash)
      // Jika model dari client adalah pro/preview, gunakan model tersebut secara dinamis.
      let selectedModel = this.defaultModel;
      if (model) {
        const cleanModel = model.replace(/^(google\/|openai\/)/i, '');
        if (!cleanModel.toLowerCase().includes('flash')) {
          selectedModel = cleanModel;
        }
      }
      const { contents, systemInstruction } = this.mapOpenAiToGemini(messages);

      const config: any = {};
      if (systemInstruction) {
        config.systemInstruction = systemInstruction;
      }

      // Build tools
      const toolsList: any[] = [];
      if (webSearch) {
        toolsList.push({ googleSearch: {} });
      } else {
        // Tambahkan function calling tools HANYA jika tidak menggunakan webSearch
        toolsList.push({
          functionDeclarations: [
            {
              name: 'getGamificationStats',
              description: 'Mengambil data profil gamifikasi warga yang aktif saat ini, termasuk level, XP, streak, dan daftar lencana (badges).',
              parameters: { type: 'OBJECT', properties: {} }
            },
            {
              name: 'getRecentReports',
              description: 'Mengambil daftar laporan masalah lingkungan terbaru yang dilaporkan oleh warga yang aktif beserta status penanganan terbarunya.',
              parameters: { type: 'OBJECT', properties: {} }
            },
            {
              name: 'getTopLeaderboard',
              description: 'Mengambil peringkat 5 besar warga dengan XP tertinggi saat ini di kota.',
              parameters: { type: 'OBJECT', properties: {} }
            }
          ]
        });
      }

      if (toolsList.length > 0) {
        config.tools = toolsList;
      }

      // Mulai streaming dari Vertex AI
      const responseStream = await this.ai.models.generateContentStream({
        model: selectedModel,
        contents,
        config,
      });

      const self = this;
      let functionCallToExecute: any = null;

      // Buat ReadableStream kustom untuk membungkus data ke dalam format SSE OpenAI
      const readable = new ReadableStream({
        async start(controller) {
          const encoder = new TextEncoder();
          const streamId = `gen-${Date.now()}-${Math.random().toString(36).substring(2, 10)}`;

          try {
            // Berikan penanda stream di awal
            controller.enqueue(encoder.encode(': GOOGLE VERTEX AI STREAMING\n\n'));

            const seenUris = new Set<string>();
            const citationsList: Array<{ title: string; url: string }> = [];

            let textBuffer = '';
            let firstChunkFlushed = false;
            const firstChunkThreshold = 250;
            const sentenceThreshold = 100;
            const sentenceBoundary = /[.!?\n]/;
            let annotations: any[] | undefined = undefined;

            for await (const chunk of responseStream) {
              if (chunk.functionCalls && chunk.functionCalls.length > 0) {
                functionCallToExecute = chunk.functionCalls[0];
                break;
              }

              const text = chunk.text;
              
              // Ekstrak metadata pencarian web (grounding) jika dikembalikan di chunk ini
              const searchChunks = chunk.candidates?.[0]?.groundingMetadata?.groundingChunks;
              const searchSupports = chunk.candidates?.[0]?.groundingMetadata?.groundingSupports;
              
              if (searchChunks) {
                for (const sc of searchChunks) {
                  const rawUri = sc.web?.uri;
                  if (rawUri) {
                    const uri = self.extractDirectUrl(rawUri);
                    const title = sc.web?.title || 'Sumber Terpercaya';
                    if (!seenUris.has(uri)) {
                      seenUris.add(uri);
                      citationsList.push({ title, url: uri });
                    }
                  }
                }
              }

              if (searchChunks && searchSupports) {
                annotations = searchSupports.map((support: any) => {
                  const sourceIndices = support.groundingChunkIndices || [];
                  const firstSourceIndex = sourceIndices[0] ?? 0;
                  const searchChunk = searchChunks[firstSourceIndex];
                  const directUrl = self.extractDirectUrl(searchChunk?.web?.uri || '');
                  
                  return {
                    type: 'web_search_citation',
                    url_citation: {
                      url: directUrl,
                      title: searchChunk?.web?.title || 'Sumber Terpercaya',
                      content: searchChunk?.web?.title || '',
                      start_index: support.segment?.startIndex ?? 0,
                      end_index: support.segment?.endIndex ?? 0,
                    }
                  };
                });
              }

              if (text) {
                textBuffer += text;
                const shouldFlush = !firstChunkFlushed
                  ? (textBuffer.length >= firstChunkThreshold || textBuffer.includes('\n\n'))
                  : (textBuffer.length >= sentenceThreshold || sentenceBoundary.test(textBuffer));

                if (shouldFlush) {
                  const ssePayload = {
                    id: streamId,
                    object: 'chat.completion.chunk',
                    created: Math.floor(Date.now() / 1000),
                    model: selectedModel,
                    provider: 'GoogleCloud',
                    choices: [
                      {
                        index: 0,
                        delta: {
                          content: textBuffer,
                          role: 'assistant',
                          ...(annotations ? { annotations } : {}),
                        },
                        finish_reason: null,
                      },
                    ],
                  };
                  controller.enqueue(encoder.encode(`data: ${JSON.stringify(ssePayload)}\n\n`));
                  firstChunkFlushed = true;
                  textBuffer = '';
                  annotations = undefined;
                }
              } else if (annotations) {
                const ssePayload = {
                  id: streamId,
                  object: 'chat.completion.chunk',
                  created: Math.floor(Date.now() / 1000),
                  model: selectedModel,
                  provider: 'GoogleCloud',
                  choices: [
                    {
                      index: 0,
                      delta: {
                        content: '',
                        role: 'assistant',
                        annotations,
                      },
                      finish_reason: null,
                    },
                  ],
                };
                controller.enqueue(encoder.encode(`data: ${JSON.stringify(ssePayload)}\n\n`));
                annotations = undefined;
              }
            }

            // Jika ada function call yang diintersept, kita eksekusi dan teruskan recursive stream ke controller
            if (functionCallToExecute) {
              const result = await self.executeFunctionCall(
                functionCallToExecute.name,
                functionCallToExecute.args,
                userId,
              );

              const updatedMessages = [
                ...messages,
                {
                  role: 'assistant',
                  functionCall: functionCallToExecute,
                  content: '',
                },
                {
                  role: 'tool',
                  name: functionCallToExecute.name,
                  response: { result },
                  content: '',
                }
              ];

              const recursiveResponse = await self.getChatCompletionStream(
                updatedMessages,
                model,
                webSearch,
                userId,
              );

              const reader = recursiveResponse.body?.getReader();
              if (reader) {
                while (true) {
                  const { done, value } = await reader.read();
                  if (done) break;
                  controller.enqueue(value);
                }
              }
              return;
            }

            // Flush sisa buffer teks jika ada sebelum citations
            if (textBuffer.length > 0) {
              const ssePayload = {
                id: streamId,
                object: 'chat.completion.chunk',
                created: Math.floor(Date.now() / 1000),
                model: selectedModel,
                provider: 'GoogleCloud',
                choices: [
                  {
                    index: 0,
                    delta: {
                      content: textBuffer,
                      role: 'assistant',
                    },
                    finish_reason: null,
                  },
                ],
              };
              controller.enqueue(encoder.encode(`data: ${JSON.stringify(ssePayload)}\n\n`));
            }

            // Jika ada sitasi terkumpul, kirimkan daftar tautan di akhir respon secara otomatis
            if (citationsList.length > 0) {
              let citationText = '\n\n**Sumber Referensi:**';

              const resolvedList = await Promise.all(
                citationsList.map(async (cit) => {
                  let uri = cit.url;
                  if (uri.includes('grounding-redirect') || uri.includes('grounding-api-redirect')) {
                    uri = await self.resolveRedirectUrl(uri);
                  }
                  return { ...cit, url: uri };
                })
              );

              for (const cit of resolvedList) {
                let domain = 'web';
                try {
                  domain = new URL(cit.url).hostname.replace('www.', '');
                } catch (_) {}
                citationText += `\n* [${domain}](${cit.url})`;
              }

              const citationPayload = {
                id: streamId,
                object: 'chat.completion.chunk',
                created: Math.floor(Date.now() / 1000),
                model: selectedModel,
                provider: 'GoogleCloud',
                choices: [
                  {
                    index: 0,
                    delta: {
                      content: citationText,
                      role: 'assistant',
                    },
                    finish_reason: null,
                  },
                ],
              };
              controller.enqueue(encoder.encode(`data: ${JSON.stringify(citationPayload)}\n\n`));
            }

            // Kirim sinyal finish
            const finalPayload = {
              id: streamId,
              object: 'chat.completion.chunk',
              created: Math.floor(Date.now() / 1000),
              model: selectedModel,
              provider: 'GoogleCloud',
              choices: [
                {
                  index: 0,
                  delta: { content: '' },
                  finish_reason: 'stop',
                },
              ],
            };
            controller.enqueue(encoder.encode(`data: ${JSON.stringify(finalPayload)}\n\n`));
            controller.enqueue(encoder.encode('data: [DONE]\n\n'));
          } catch (streamError) {
            controller.error(streamError);
          } finally {
            controller.close();
          }
        },
      });

      return new Response(readable, {
        headers: {
          'Content-Type': 'text/event-stream',
          'Cache-Control': 'no-cache',
          Connection: 'keep-alive',
        },
      });
    } catch (error) {
      this.logger.error(`Error initiating chat stream via Vertex AI: ${error.message}`);
      throw error;
    }
  }

  /**
   * Mengirim request chat completion secara instan (non-streaming)
   */
  async getChatCompletion(
    messages: any[],
    model?: string,
    webSearch?: boolean,
    userId?: string,
  ): Promise<{ content: string; annotations?: Array<{ type: string; url_citation: { url: string; title: string; content?: string; start_index: number; end_index: number } }> }> {
    try {
      // Jika model dari client adalah flash (atau tidak ada), gunakan defaultModel dari .env (misal gemini-3.5-flash)
      // Jika model dari client adalah pro/preview, gunakan model tersebut secara dinamis.
      let selectedModel = this.defaultModel;
      if (model) {
        const cleanModel = model.replace(/^(google\/|openai\/)/i, '');
        if (!cleanModel.toLowerCase().includes('flash')) {
          selectedModel = cleanModel;
        }
      }
      const { contents, systemInstruction } = this.mapOpenAiToGemini(messages);

      const config: any = {};
      if (systemInstruction) {
        config.systemInstruction = systemInstruction;
      }

      // Build tools
      const toolsList: any[] = [];
      if (webSearch) {
        toolsList.push({ googleSearch: {} });
      } else {
        // Tambahkan function calling tools HANYA jika tidak menggunakan webSearch
        toolsList.push({
          functionDeclarations: [
            {
              name: 'getGamificationStats',
              description: 'Mengambil data profil gamifikasi warga yang aktif saat ini, termasuk level, XP, streak, dan daftar lencana (badges).',
              parameters: { type: 'OBJECT', properties: {} }
            },
            {
              name: 'getRecentReports',
              description: 'Mengambil daftar laporan masalah lingkungan terbaru yang dilaporkan oleh warga yang aktif beserta status penanganan terbarunya.',
              parameters: { type: 'OBJECT', properties: {} }
            },
            {
              name: 'getTopLeaderboard',
              description: 'Mengambil peringkat 5 besar warga dengan XP tertinggi saat ini di kota.',
              parameters: { type: 'OBJECT', properties: {} }
            }
          ]
        });
      }

      if (toolsList.length > 0) {
        config.tools = toolsList;
      }

      const response = await this.ai.models.generateContent({
        model: selectedModel,
        contents,
        config,
      });

      // Jika Gemini ingin memanggil fungsi lokal
      if (response.functionCalls && response.functionCalls.length > 0) {
        const functionCall = response.functionCalls[0];
        const result = await this.executeFunctionCall(functionCall.name!, functionCall.args, userId);
        
        const updatedMessages = [
          ...messages,
          {
            role: 'assistant',
            functionCall: functionCall,
            content: '',
          },
          {
            role: 'tool',
            name: functionCall.name!,
            response: { result },
            content: '',
          }
        ];

        return this.getChatCompletion(updatedMessages, model, webSearch, userId);
      }

      // Proses pencarian web / grounding
      let annotations: any[] = [];
      const searchChunks = response.candidates?.[0]?.groundingMetadata?.groundingChunks;
      const searchSupports = response.candidates?.[0]?.groundingMetadata?.groundingSupports;
      
      if (searchChunks && searchSupports) {
        annotations = searchSupports.map((support: any) => {
          const sourceIndices = support.groundingChunkIndices || [];
          const firstSourceIndex = sourceIndices[0] ?? 0;
          const chunk = searchChunks[firstSourceIndex];
          const directUrl = this.extractDirectUrl(chunk?.web?.uri || '');
          
          return {
            type: 'web_search_citation',
            url_citation: {
              url: directUrl,
              title: chunk?.web?.title || 'Sumber Terpercaya',
              content: chunk?.web?.title || '',
              start_index: support.segment?.startIndex ?? 0,
              end_index: support.segment?.endIndex ?? 0,
            }
          };
        });
      }

      let finalContent = response.text || '';
      if (searchChunks && searchChunks.length > 0) {
        let citationText = '\n\n**Sumber Referensi:**';
        const seenUris = new Set<string>();
        const parsedCitations: Array<{ title: string; url: string }> = [];

        for (const sc of searchChunks) {
          const rawUri = sc.web?.uri;
          if (rawUri) {
            const uri = this.extractDirectUrl(rawUri);
            const title = sc.web?.title || 'Sumber Terpercaya';
            if (!seenUris.has(uri)) {
              seenUris.add(uri);
              parsedCitations.push({ title, url: uri });
            }
          }
        }

        // Resolusi url paralel
        const resolvedCitations = await Promise.all(
          parsedCitations.map(async (cit) => {
            let uri = cit.url;
            if (uri.includes('grounding-redirect') || uri.includes('grounding-api-redirect')) {
              uri = await this.resolveRedirectUrl(uri);
            }
            return { ...cit, url: uri };
          })
        );

        for (const cit of resolvedCitations) {
          let domain = 'web';
          try {
            domain = new URL(cit.url).hostname.replace('www.', '');
          } catch (_) {}
          citationText += `\n* [${domain}](${cit.url})`;
        }
        finalContent += citationText;
      }

      return {
        content: finalContent,
        annotations: annotations.length > 0 ? annotations : undefined,
      };
    } catch (error) {
      this.logger.error(`Error generating chat completion via Vertex AI: ${error.message}`);
      throw error;
    }
  }

  /**
   * Eksekusi fungsi lokal berdasarkan permintaan Gemini (Function Calling)
   */
  private async executeFunctionCall(name: string, args: any, userId?: string): Promise<any> {
    const supabase = this.supabaseService.getClient();
    this.logger.log(`Executing function call: ${name} with args: ${JSON.stringify(args)}`);

    try {
      if (name === 'getGamificationStats') {
        if (!userId) return { error: 'User tidak terautentikasi' };
        
        // 1. Ambil data profil dasar
        const { data: profile } = await supabase
          .from('profiles')
          .select('username, full_name, xp, level, current_streak')
          .eq('id', userId)
          .maybeSingle();

        // 2. Query rank dari global_leaderboard
        const { data: rankData } = await supabase
          .from('global_leaderboard')
          .select('rank')
          .eq('id', userId)
          .maybeSingle();

        // 3. Ambil badges yang diperoleh
        const { data: badgesData } = await supabase
          .from('profile_badges')
          .select('earned_at, badges(name, description, icon_url)')
          .eq('profile_id', userId);

        const badges = (badgesData || []).map((pb: any) => ({
          earned_at: pb.earned_at,
          title: pb.badges?.name || '',
          description: pb.badges?.description || '',
          icon_url: pb.badges?.icon_url || '',
        }));

        return {
          username: profile?.username || 'Warga',
          full_name: profile?.full_name || '',
          xp: profile?.xp ?? 0,
          level: profile?.level ?? 1,
          streak: (profile as any)?.current_streak ?? 0,
          rank: rankData?.rank || 1,
          badges,
        };
      }

      if (name === 'getRecentReports') {
        if (!userId) return { error: 'User tidak terautentikasi' };
        const { data: reports, error } = await supabase
          .from('reports')
          .select('id, description, status, created_at')
          .eq('reporter_id', userId)
          .order('created_at', { ascending: false })
          .limit(5);

        if (error) return { error: error.message };
        return reports || [];
      }

      if (name === 'getTopLeaderboard') {
        const { data: leaderboard, error } = await supabase
          .from('profiles')
          .select('username, full_name, xp, level')
          .eq('role', 'citizen')
          .order('xp', { ascending: false })
          .limit(5);

        if (error) return { error: error.message };
        return (leaderboard || []).map((user, idx) => ({
          rank: idx + 1,
          username: user.username,
          full_name: user.full_name,
          xp: user.xp,
          level: user.level,
        }));
      }

      return { error: `Fungsi ${name} tidak dikenali.` };
    } catch (err) {
      this.logger.error(`Error executing function call ${name}: ${err.message}`);
      return { error: `Gagal memproses data: ${err.message}` };
    }
  }

  /**
   * Mengirim gambar (buffer) untuk klasifikasi otomatis di Fitur 4
   */
  async classifyImage(imageBuffer: Buffer, mimeType: string): Promise<any> {
    const base64Image = imageBuffer.toString('base64');
    const promptText = `
      Analisis foto laporan masalah lingkungan ini secara detail.
      Tentukan:
      1. waste_type (Tipe sampah): pilih salah satu dari 'Plastik', 'Organik', 'B3' (Bahan Berbahaya Beracun), 'Kertas', 'Logam', 'Kaca', atau 'Lainnya'.
      2. danger_level (Tingkat bahaya): pilih salah satu dari 'low', 'medium', atau 'high'.
      3. isValid (Validitas): Apakah gambar ini benar-benar memperlihatkan pencemaran lingkungan, tumpukan sampah liar, limbah, atau kerusakan ekosistem yang valid? (true atau false). Jika gambar berupa selfie, pemandangan bersih, objek acak yang tidak berhubungan, atau gambar spam, maka kembalikan false.
      4. confidence_score: Tingkat keyakinan Anda terhadap klasifikasi ini antara 0.0 hingga 1.0.
      5. reason: Alasan singkat dalam bahasa Indonesia mengapa gambar diklasifikasikan demikian (maksimal 2 kalimat).

      Kembalikan respons HANYA dalam format JSON valid dengan struktur:
      {
        "waste_type": "string",
        "danger_level": "string",
        "isValid": boolean,
        "confidence_score": number,
        "reason": "string"
      }
    `;

    const messages = [
      {
        role: 'user',
        content: [
          { type: 'text', text: promptText },
          {
            type: 'image_url',
            image_url: {
              url: `data:${mimeType || 'image/jpeg'};base64,${base64Image}`,
            },
          },
        ],
      },
    ];

    try {
      const result = await this.getChatCompletion(messages);

      let cleanedJson = result.content.trim();
      if (cleanedJson.startsWith('```json')) {
        cleanedJson = cleanedJson.substring(7);
      }
      if (cleanedJson.endsWith('```')) {
        cleanedJson = cleanedJson.substring(0, cleanedJson.length - 3);
      }
      cleanedJson = cleanedJson.trim();

      return JSON.parse(cleanedJson);
    } catch (error) {
      this.logger.error(`Error classifying image via Vertex AI: ${error.message}`);
      throw error;
    }
  }

  /**
   * Mengirim base64 audio ke Gemini untuk transkripsi Speech-To-Text secara native
   */
  async transcribeAudio(
    base64Audio: string,
    format: string,
    model?: string,
  ): Promise<string> {
    try {
      const selectedModel = this.defaultModel;
      const mimeType = format === 'mp3' ? 'audio/mp3' : `audio/${format || 'wav'}`;

      const response = await this.ai.models.generateContent({
        model: selectedModel,
        contents: [
          'Transkripsikan rekaman suara berikut secara akurat ke dalam bentuk teks. Tuliskan HANYA teks transkripsinya saja tanpa komentar tambahan apapun.',
          {
            inlineData: {
              mimeType,
              data: base64Audio,
            },
          },
        ],
      });

      return response.text?.trim() || '';
    } catch (error) {
      this.logger.error(`Error transcribing audio via Vertex AI: ${error.message}`);
      throw error;
    }
  }

  /**
   * Mengekstrak URL tujuan asli dari link pengalihan (grounding redirect) Vertex AI secara sinkron (untuk parameter target)
   */
  private extractDirectUrl(url: string): string {
    if (!url) return '';
    try {
      if (url.includes('target=')) {
        const parsedUrl = new URL(url);
        const target = parsedUrl.searchParams.get('target');
        if (target) {
          return decodeURIComponent(target);
        }
      }
    } catch (_) {}
    return url;
  }

  /**
   * Melakukan resolusi tautan pengalihan (grounding redirect) secara dinamis
   * Mendukung dekode parameter instan (?target=...) maupun request HEAD untuk token acak (/grounding-api-redirect/...)
   */
  private async resolveRedirectUrl(url: string): Promise<string> {
    if (!url) return '';
    
    // 1. Coba dekode parameter target secara instan
    const decoded = this.extractDirectUrl(url);
    if (decoded !== url) {
      return decoded;
    }
    
    // 2. Jika tautan berbentuk token terenkripsi, lakukan request HEAD cepat untuk membaca header Location
    try {
      if (url.includes('grounding-api-redirect') || url.includes('grounding-redirect')) {
        const response = await fetch(url, {
          method: 'HEAD',
          redirect: 'manual',
        });
        const location = response.headers.get('location');
        if (location) {
          return location;
        }
      }
    } catch (_) {}
    
    return url;
  }
}
