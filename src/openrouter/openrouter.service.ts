import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { GoogleGenAI } from '@google/genai';
import * as fs from 'fs';

@Injectable()
export class OpenRouterService {
  private readonly logger = new Logger(OpenRouterService.name);
  private readonly ai: GoogleGenAI;
  private readonly defaultModel: string;
  private readonly embeddingModel: string;

  constructor(private configService: ConfigService) {
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
    this.embeddingModel = rawEmbedModel.replace(/^(google\/|openai\/)/i, '');
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

      const role = msg.role === 'assistant' ? 'model' : 'user';
      const parts: any[] = [];

      if (typeof msg.content === 'string') {
        parts.push({ text: msg.content });
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
  async getChatCompletionStream(
    messages: any[],
    model?: string,
    webSearch?: boolean,
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
      if (webSearch) {
        config.tools = [{ googleSearch: {} }];
      }

      // Mulai streaming dari Vertex AI Singapura
      const responseStream = await this.ai.models.generateContentStream({
        model: selectedModel,
        contents,
        config,
      });

      const self = this;
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

            for await (const chunk of responseStream) {
              const text = chunk.text;
              
              // Ekstrak metadata pencarian web (grounding) jika dikembalikan di chunk ini
              let annotations: any[] | undefined = undefined;
              const searchChunks = chunk.candidates?.[0]?.groundingMetadata?.groundingChunks;
              const searchSupports = chunk.candidates?.[0]?.groundingMetadata?.groundingSupports;
              
              if (searchChunks) {
                // Catat link unik ke list rujukan kita
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

              if (text || annotations) {
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
                        content: text || '',
                        role: 'assistant',
                        ...(annotations ? { annotations } : {}),
                      },
                      finish_reason: null,
                    },
                  ],
                };
                controller.enqueue(encoder.encode(`data: ${JSON.stringify(ssePayload)}\n\n`));
              }
            }

            // Jika ada sitasi terkumpul, kirimkan daftar tautan di akhir respon secara otomatis
            if (citationsList.length > 0) {
              let citationText = '\n\n**Sumber Referensi:**';
              for (const cit of citationsList) {
                let uri = cit.url;
                if (uri.includes('grounding-redirect') || uri.includes('grounding-api-redirect')) {
                  uri = await self.resolveRedirectUrl(uri);
                }
                let domain = 'web';
                try {
                  domain = new URL(uri).hostname.replace('www.', '');
                } catch (_) {}
                citationText += `\n* [${domain}](${uri})`;
              }

              // Buat payload SSE berisi teks sitasi akhir
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
      if (webSearch) {
        config.tools = [{ googleSearch: {} }];
      }

      const response = await this.ai.models.generateContent({
        model: selectedModel,
        contents,
        config,
      });

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
        for (const sc of searchChunks) {
          const rawUri = sc.web?.uri;
          if (rawUri) {
            let uri = rawUri;
            if (rawUri.includes('grounding-redirect') || rawUri.includes('grounding-api-redirect')) {
              uri = await this.resolveRedirectUrl(rawUri);
            }
            if (!seenUris.has(uri)) {
              seenUris.add(uri);
              let domain = 'web';
              try {
                domain = new URL(uri).hostname.replace('www.', '');
              } catch (_) {}
              citationText += `\n* [${domain}](${uri})`;
            }
          }
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

      Kembalikan respons HANYA dalam format JSON valid dengan struktur:
      {
        "waste_type": "string",
        "danger_level": "string",
        "isValid": boolean,
        "confidence_score": number
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
