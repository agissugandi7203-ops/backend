import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

@Injectable()
export class OpenRouterService {
  private readonly logger = new Logger(OpenRouterService.name);
  private readonly apiKey: string;
  private readonly defaultModel: string;
  private readonly embeddingModel: string;
  private readonly baseUrl = 'https://openrouter.ai/api/v1';

  constructor(private configService: ConfigService) {
    this.apiKey = this.configService.get<string>('OPENROUTER_API_KEY') || '';
    this.defaultModel = this.configService.get<string>('OPENROUTER_MODEL') || 'google/gemini-2.5-flash';
    this.embeddingModel = this.configService.get<string>('OPENROUTER_EMBEDDING_MODEL') || 'google/gemini-embedding-2';

    if (!this.apiKey) {
      this.logger.warn('OPENROUTER_API_KEY is not defined in environment variables. AI features will be disabled!');
    }
  }

  /**
   * Mendapatkan array embedding vektor untuk teks input
   */
  async getEmbedding(text: string): Promise<number[]> {
    if (!this.apiKey) {
      throw new Error('OpenRouter API key is not configured.');
    }

    try {
      const response = await fetch(`${this.baseUrl}/embeddings`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${this.apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          model: this.embeddingModel,
          input: text,
        }),
      });

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`OpenRouter Embeddings API returned status ${response.status}: ${errorText}`);
      }

      const result = await response.json();
      const embedding = result.data?.[0]?.embedding;
      if (!embedding || !Array.isArray(embedding)) {
        throw new Error('Invalid embedding response format from OpenRouter');
      }

      return embedding;
    } catch (error) {
      this.logger.error(`Error generating embedding: ${error.message}`);
      throw error;
    }
  }

  /**
   * Mengirim request chat completion dengan streaming (kembali berupa raw Response stream)
   */
  async getChatCompletionStream(messages: any[], model?: string): Promise<Response> {
    if (!this.apiKey) {
      throw new Error('OpenRouter API key is not configured.');
    }

    try {
      const response = await fetch(`${this.baseUrl}/chat/completions`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${this.apiKey}`,
          'Content-Type': 'application/json',
          'HTTP-Referer': 'https://genesisHub.web.id',
          'X-Title': 'GenesisHub Smart City Portal',
        },
        body: JSON.stringify({
          model: model || this.defaultModel,
          messages,
          stream: true,
        }),
      });

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`OpenRouter Completions API returned status ${response.status}: ${errorText}`);
      }

      return response;
    } catch (error) {
      this.logger.error(`Error initiating chat stream: ${error.message}`);
      throw error;
    }
  }

  /**
   * Mengirim request chat completion secara instan (non-streaming)
   */
  async getChatCompletion(messages: any[], model?: string): Promise<string> {
    if (!this.apiKey) {
      throw new Error('OpenRouter API key is not configured.');
    }

    try {
      const response = await fetch(`${this.baseUrl}/chat/completions`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${this.apiKey}`,
          'Content-Type': 'application/json',
          'HTTP-Referer': 'https://genesisHub.web.id',
          'X-Title': 'GenesisHub Smart City Portal',
        },
        body: JSON.stringify({
          model: model || this.defaultModel,
          messages,
          stream: false,
        }),
      });

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`OpenRouter Completions API returned status ${response.status}: ${errorText}`);
      }

      const result = await response.json();
      const content = result.choices?.[0]?.message?.content;
      if (content === undefined) {
        throw new Error('Invalid chat completion response from OpenRouter');
      }

      return content;
    } catch (error) {
      this.logger.error(`Error generating chat completion: ${error.message}`);
      throw error;
    }
  }

  /**
   * Mengirim gambar (buffer) untuk klasifikasi otomatis di Fitur 4
   */
  async classifyImage(imageBuffer: Buffer, mimeType: string): Promise<any> {
    if (!this.apiKey) {
      throw new Error('OpenRouter API key is not configured.');
    }

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
      const responseText = await this.getChatCompletion(messages);
      
      // Bersihkan string dari format markdown ```json ... ``` jika ada
      let cleanedJson = responseText.trim();
      if (cleanedJson.startsWith('```json')) {
        cleanedJson = cleanedJson.substring(7);
      }
      if (cleanedJson.endsWith('```')) {
        cleanedJson = cleanedJson.substring(0, cleanedJson.length - 3);
      }
      cleanedJson = cleanedJson.trim();

      return JSON.parse(cleanedJson);
    } catch (error) {
      this.logger.error(`Error classifying image via OpenRouter: ${error.message}`);
      throw error;
    }
  }
}
