import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { SupabaseService } from '../supabase/supabase.service';
import { ProfilesService } from '../profiles/profiles.service';
import { OpenRouterService } from '../openrouter/openrouter.service';

@Injectable()
export class AiClassificationService implements OnModuleInit {
  private readonly logger = new Logger(AiClassificationService.name);

  constructor(
    private supabaseService: SupabaseService,
    private profilesService: ProfilesService,
    private openRouterService: OpenRouterService,
  ) {}

  onModuleInit() {
    this.logger.log(
      'AiClassificationService successfully initialized with OpenRouter integration.',
    );
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
    this.classifyProcess(reportId, imageBuffer, reporterId, mimeType).catch(
      (err) => {
        this.logger.error(
          `Error in background classification for report ${reportId}: ${err.message}`,
        );
      },
    );
  }

  private async classifyProcess(
    reportId: string,
    imageBuffer: Buffer,
    reporterId: string,
    mimeType: string,
  ): Promise<void> {
    this.logger.log(`Starting AI classification for report: ${reportId}`);

    try {
      // Panggil OpenRouter image classifier
      const result = await this.openRouterService.classifyImage(
        imageBuffer,
        mimeType,
      );
      this.logger.log(
        `AI Classification result for ${reportId}: ${JSON.stringify(result)}`,
      );

      const wasteType = result.waste_type || 'Lainnya';
      const dangerLevel = result.danger_level || 'low';
      const confidenceScore = result.confidence_score || 0.0;
      const isValid = result.isValid === true;
      const aiNotes = result.reason || 'Selesai dianalisis oleh AI';

      const supabase = this.supabaseService.getClient();

      // Aturan persetujuan otomatis (Confidence Score > 85% dan isValid = true)
      if (isValid && confidenceScore > 0.85) {
        this.logger.log(
          `Report ${reportId} auto-approved by AI (confidence: ${confidenceScore})`,
        );

        // 1. Update report status ke approved
        const { error: updateError } = await supabase
          .from('reports')
          .update({
            status: 'approved',
            waste_type: wasteType,
            danger_level: dangerLevel,
            confidence_score: confidenceScore,
            ai_notes: aiNotes,
            updated_at: new Date().toISOString(),
          })
          .eq('id', reportId);

        if (updateError) {
          throw new Error(
            'Failed to update report approval status: ' + updateError.message,
          );
        }

        // 2. Berikan reward gamifikasi kepada pelapor
        try {
          const rewardResult =
            await this.profilesService.awardReportRewards(reporterId);
          this.logger.log(
            `Successfully awarded rewards to user ${reporterId}: ${JSON.stringify(rewardResult)}`,
          );
        } catch (rewardErr) {
          this.logger.error(
            `Failed to award gamification rewards to user ${reporterId}: ${rewardErr.message}`,
          );
        }
      } else {
        // Jika confidence rendah atau gambar tidak valid, arahkan ke peninjauan manual oleh admin
        const targetStatus = isValid ? 'pending_human' : 'rejected';
        this.logger.log(
          `Report ${reportId} needs moderation or is invalid. Setting status to ${targetStatus}`,
        );

        await supabase
          .from('reports')
          .update({
            status: targetStatus,
            waste_type: wasteType,
            danger_level: dangerLevel,
            confidence_score: confidenceScore,
            ai_notes: aiNotes,
            updated_at: new Date().toISOString(),
          })
          .eq('id', reportId);
      }
    } catch (error) {
      this.logger.error(
        `Error calling OpenRouter API or parsing response: ${error.message}`,
      );
      // Fallback: Set status ke pending_human jika API error agar admin dapat meninjau manual
      await this.updateReportStatusOnly(reportId, 'pending_human');
    }
  }

  private async updateReportStatusOnly(
    reportId: string,
    status: string,
  ): Promise<void> {
    try {
      const supabase = this.supabaseService.getClient();
      await supabase
        .from('reports')
        .update({ status, updated_at: new Date().toISOString() })
        .eq('id', reportId);
    } catch (e) {
      this.logger.error(
        `Failed to update fallback status for report ${reportId}: ${e.message}`,
      );
    }
  }
}
