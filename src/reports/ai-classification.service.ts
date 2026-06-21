import { Injectable, Logger, OnModuleInit, Inject, forwardRef } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { SupabaseService } from '../supabase/supabase.service';
import { ProfilesService } from '../profiles/profiles.service';
import { GoogleGenAI } from '@google/genai';

@Injectable()
export class AiClassificationService implements OnModuleInit {
  private readonly logger = new Logger(AiClassificationService.name);
  private ai: GoogleGenAI;
  private modelName: string;

  constructor(
    private configService: ConfigService,
    private supabaseService: SupabaseService,
    private profilesService: ProfilesService,
  ) {}

  onModuleInit() {
    const apiKey = this.configService.get<string>('GEMINI_API_KEY');
    this.modelName = this.configService.get<string>('GEMINI_MODEL') || 'gemini-1.5-flash';

    if (!apiKey) {
      this.logger.warn(
        'GEMINI_API_KEY belum dikonfigurasi di file .env. Otomatisasi Klasifikasi AI dinonaktifkan.',
      );
      return;
    }

    try {
      this.ai = new GoogleGenAI({ apiKey });
      this.logger.log(`Google Gen AI client successfully initialized with model ${this.modelName}`);
    } catch (error) {
      this.logger.error('Failed to initialize Google Gen AI client: ' + error.message);
    }
  }

  /**
   * Menjalankan analisis klasifikasi gambar secara asinkronus di latar belakang (fire-and-forget).
   */
  async classifyReportInBackground(
    reportId: string,
    imageBuffer: Buffer,
    reporterId: string,
    mimeType: string,
  ): Promise<void> {
    // Jalankan tanpa menunggu di controller utama
    this.classifyProcess(reportId, imageBuffer, reporterId, mimeType).catch((err) => {
      this.logger.error(`Error in background classification for report ${reportId}: ${err.message}`);
    });
  }

  private async classifyProcess(
    reportId: string,
    imageBuffer: Buffer,
    reporterId: string,
    mimeType: string,
  ): Promise<void> {
    if (!this.ai) {
      this.logger.warn('Klien Gemini API belum terinisialisasi. Melewati klasifikasi AI.');
      // Ubah status ke pending_human jika AI key tidak ada agar admin bisa memproses secara manual
      await this.updateReportStatusOnly(reportId, 'pending_human');
      return;
    }

    this.logger.log(`Starting AI classification for report: ${reportId}`);

    const base64Image = imageBuffer.toString('base64');
    const promptText = `
      Analisis foto laporan masalah lingkungan ini secara detail.
      Tentukan:
      1. waste_type (Tipe sampah): pilih salah satu dari 'Plastik', 'Organik', 'B3' (Bahan Berbahaya Beracun), 'Kertas', 'Logam', 'Kaca', atau 'Lainnya'.
      2. danger_level (Tingkat bahaya): pilih salah satu dari 'low', 'medium', atau 'high'.
      3. isValid (Validitas): Apakah gambar ini benar-benar memperlihatkan pencemaran lingkungan, tumpukan sampah liar, limbah, atau kerusakan ekosistem yang valid? (true atau false). Jika gambar berupa selfie, pemandangan bersih, objek acak yang tidak berhubungan, atau gambar spam, maka kembalikan false.
      4. confidence_score: Tingkat keyakinan Anda terhadap klasifikasi ini antara 0.0 hingga 1.0.

      Kembalikan respons sesuai dengan JSON schema yang ditentukan.
    `;

    try {
      const response = await this.ai.models.generateContent({
        model: this.modelName,
        contents: [
          {
            inlineData: {
              mimeType: mimeType || 'image/jpeg',
              data: base64Image,
            },
          },
          {
            text: promptText,
          },
        ],
        config: {
          responseMimeType: 'application/json',
          responseSchema: {
            type: 'OBJECT',
            properties: {
              waste_type: { type: 'STRING' },
              danger_level: { type: 'STRING' },
              isValid: { type: 'BOOLEAN' },
              confidence_score: { type: 'NUMBER' },
            },
            required: ['waste_type', 'danger_level', 'isValid', 'confidence_score'],
          },
        },
      });

      const responseText = response.text;
      if (!responseText) {
        throw new Error('Gemini API returned an empty response');
      }

      const result = JSON.parse(responseText);
      this.logger.log(`AI Classification raw result for ${reportId}: ${JSON.stringify(result)}`);

      const wasteType = result.waste_type || 'Lainnya';
      const dangerLevel = result.danger_level || 'low';
      const confidenceScore = result.confidence_score || 0.0;
      const isValid = result.isValid === true;

      const supabase = this.supabaseService.getClient();

      // Aturan persetujuan otomatis (Confidence Score > 85% dan isValid = true)
      if (isValid && confidenceScore > 0.85) {
        this.logger.log(`Report ${reportId} auto-approved by AI (confidence: ${confidenceScore})`);
        
        // 1. Update report status ke approved
        const { error: updateError } = await supabase
          .from('reports')
          .update({
            status: 'approved',
            waste_type: wasteType,
            danger_level: dangerLevel,
            confidence_score: confidenceScore,
            updated_at: new Date().toISOString(),
          })
          .eq('id', reportId);

        if (updateError) {
          throw new Error('Failed to update report approval status: ' + updateError.message);
        }

        // 2. Berikan reward gamifikasi kepada pelapor
        try {
          const rewardResult = await this.profilesService.awardReportRewards(reporterId);
          this.logger.log(`Successfully awarded rewards to user ${reporterId}: ${JSON.stringify(rewardResult)}`);
        } catch (rewardErr) {
          this.logger.error(`Failed to award gamification rewards to user ${reporterId}: ${rewardErr.message}`);
        }
      } else {
        // Jika confidence rendah atau gambar tidak valid, arahkan ke peninjauan manual oleh admin
        const targetStatus = isValid ? 'pending_human' : 'rejected';
        this.logger.log(`Report ${reportId} needs moderation or is invalid. Setting status to ${targetStatus}`);

        await supabase
          .from('reports')
          .update({
            status: targetStatus,
            waste_type: wasteType,
            danger_level: dangerLevel,
            confidence_score: confidenceScore,
            updated_at: new Date().toISOString(),
          })
          .eq('id', reportId);
      }
    } catch (error) {
      this.logger.error(`Error calling Gemini API or parsing response: ${error.message}`);
      // Fallback: Set status ke pending_human jika API error agar admin dapat meninjau manual
      await this.updateReportStatusOnly(reportId, 'pending_human');
    }
  }

  private async updateReportStatusOnly(reportId: string, status: string): Promise<void> {
    try {
      const supabase = this.supabaseService.getClient();
      await supabase
        .from('reports')
        .update({ status, updated_at: new Date().toISOString() })
        .eq('id', reportId);
    } catch (e) {
      this.logger.error(`Failed to update fallback status for report ${reportId}: ${e.message}`);
    }
  }
}
