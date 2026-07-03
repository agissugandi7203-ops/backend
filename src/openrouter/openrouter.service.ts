import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { GoogleGenAI } from '@google/genai';

@Injectable()
export class OpenRouterService {
  private readonly logger = new Logger(OpenRouterService.name);
  private readonly ai: GoogleGenAI;
  private readonly defaultModel: string;
  private readonly embeddingModel: string;

  constructor(private configService: ConfigService) {
    const projectId = this.configService.get<string>('GCS_PROJECT_ID') || 'arief-fajar';
    const keyFilePath = this.configService.get<string>('GCS_KEY_FILE_PATH');

    // Set credentials for Google GenAI SDK if key file path is provided in local environment
    if (keyFilePath) {
      process.env.GOOGLE_APPLICATION_CREDENTIALS = keyFilePath;
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

    // Default to Gemini 2.5 Flash Lite
    this.defaultModel =
      this.configService.get<string>('OPENROUTER_MODEL') ||
      'gemini-2.5-flash-lite';
    
    // Default to text-embedding-004 (768 dimensions)
    this.embeddingModel =
      this.configService.get<string>('OPENROUTER_EMBEDDING_MODEL') ||
      'text-embedding-004';
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
      // Prioritaskan model default dari .env (biasanya gemini-2.5-flash-lite)
      const selectedModel = this.defaultModel;
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

      // Buat ReadableStream kustom untuk membungkus data ke dalam format SSE OpenAI
      const readable = new ReadableStream({
        async start(controller) {
          const encoder = new TextEncoder();
          const streamId = `gen-${Date.now()}-${Math.random().toString(36).substring(2, 10)}`;

          try {
            // Berikan penanda stream di awal
            controller.enqueue(encoder.encode(': GOOGLE VERTEX AI STREAMING\n\n'));

            for await (const chunk of responseStream) {
              const text = chunk.text;
              if (text) {
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
                        content: text,
                        role: 'assistant',
                      },
                      finish_reason: null,
                    },
                  ],
                };
                controller.enqueue(encoder.encode(`data: ${JSON.stringify(ssePayload)}\n\n`));
              }
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
      const selectedModel = this.defaultModel;
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
          
          return {
            type: 'web_search_citation',
            url_citation: {
              url: chunk?.web?.uri || '',
              title: chunk?.web?.title || 'Sumber Terpercaya',
              content: chunk?.web?.title || '',
              start_index: support.segment?.startIndex ?? 0,
              end_index: support.segment?.endIndex ?? 0,
            }
          };
        });
      }

      return {
        content: response.text || '',
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
}
