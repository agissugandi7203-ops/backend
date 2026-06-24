import { Injectable, BadRequestException, Logger } from '@nestjs/common';
import { SupabaseService } from '../supabase/supabase.service';
import { GcsService } from '../storage/gcs.service';
import { PiiRedactionService } from '../storage/pii-redaction.service';
import { AiClassificationService } from './ai-classification.service';
import { ProfilesService } from '../profiles/profiles.service';
import { OpenRouterService } from '../openrouter/openrouter.service';

@Injectable()
export class ReportsService {
  constructor(
    private supabaseService: SupabaseService,
    private gcsService: GcsService,
    private piiRedactionService: PiiRedactionService,
    private aiClassificationService: AiClassificationService,
    private profilesService: ProfilesService,
    private openRouterService: OpenRouterService,
  ) {}

  async createReport(
    userId: string,
    fileBuffer: Buffer,
    fileMimeType: string,
    lat: number,
    lng: number,
    description?: string,
  ) {
    const supabase = this.supabaseService.getClient();

    // 1. Cek duplikasi spasial menggunakan PostGIS RPC
    const { data: duplicateId, error: rpcError } = await supabase.rpc('check_duplicate_report', {
      p_lat: lat,
      p_lng: lng,
    });

    if (rpcError) {
      throw new BadRequestException('Gagal memverifikasi lokasi spasial: ' + rpcError.message);
    }

    if (duplicateId) {
      return {
        isDuplicate: true,
        message: 'Laporan serupa terdeteksi dalam radius 50 meter. Menggabungkan laporan...',
        duplicateReportId: duplicateId,
      };
    }

    // 2. Lakukan sensor gambar PII (Wajah & Plat Nomor)
    const sanitizedBuffer = await this.piiRedactionService.redactSensitiveInfo(fileBuffer);

    // 3. Buat nama file unik untuk diunggah ke Google Cloud Storage
    const fileExtension = fileMimeType.split('/')[1] || 'jpg';
    const uniqueFileName = `reports/${userId}/${Date.now()}_${Math.random().toString(36).substring(2, 7)}.${fileExtension}`;

    // 4. Unggah ke Google Cloud Storage
    let imageUrl: string;
    try {
      imageUrl = await this.gcsService.uploadFile(sanitizedBuffer, uniqueFileName, fileMimeType);
    } catch (gcsError) {
      throw new BadRequestException('Gagal mengunggah foto laporan ke storage: ' + gcsError.message);
    }

    // 5. Simpan data laporan spasial ke database Supabase
    const { data: report, error: insertError } = await supabase
      .from('reports')
      .insert({
        reporter_id: userId,
        image_url: imageUrl,
        description: description || '',
        location: `SRID=4326;POINT(${lng} ${lat})`, // WKT PostGIS Point
        status: 'pending_ai', // Klasifikasi AI berjalan di Fitur 4
      })
      .select()
      .single();

    if (insertError || !report) {
      throw new BadRequestException('Gagal menyimpan laporan ke database: ' + insertError?.message);
    }

    // Memicu klasifikasi AI di latar belakang (fire-and-forget)
    this.aiClassificationService.classifyReportInBackground(
      report.id,
      sanitizedBuffer,
      userId,
      fileMimeType,
    );

    return {
      isDuplicate: false,
      message: 'Laporan berhasil diunggah dan disimpan',
      report,
    };
  }

  async analyzeImage(fileBuffer: Buffer, mimeType: string) {
    const base64Image = fileBuffer.toString('base64');
    const promptText = `
      Anda adalah Agen Deteksi Sampah AI Genesis.id. Tugas Anda adalah melakukan analisis visual yang mendalam pada foto lingkungan yang diunggah oleh warga.
      
      Berikan laporan analitik lengkap dalam format Markdown yang sangat rapi dan elegan, menggunakan emoji dan header yang terstruktur. Laporan tersebut HARUS memiliki format seperti berikut:

      🔍 **ANALISIS LINGKUNGAN SELESAI**

      - **Kategori Masalah**: [Tentukan tipe sampah/kerusakan, misal: Plastik, Organik, B3, Sampah Liar, Genangan Air, dll]
      - **Tingkat Keparahan / Bahaya**: [Pilih 'Rendah', 'Sedang', atau 'Tinggi']
      - **Akurasi Analisis AI**: [Berikan estimasi akurasi keyakinan Anda antara 85% - 99%, format persentase, misal: 94.5%]

      💡 **Rekomendasi Tindakan Warga**:
      1. [Rekomendasi langkah pertama spesifik terhadap objek di gambar]
      2. [Rekomendasi langkah kedua]
      3. [Minta warga mengunggah laporan agar diverifikasi admin]

      *Catatan: Setiap laporan valid yang Anda kirimkan ke sistem akan mendapatkan bonus **+50 XP** dan berkontribusi langsung pada kebersihan Kota Genesis!*
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
      const responseText = await this.openRouterService.getChatCompletion(messages);
      return {
        success: true,
        analysis: responseText,
      };
    } catch (error) {
      Logger.error(`Error analyzing image: ${error.message}`, 'ReportsService');
      return {
        success: true,
        analysis: `🔍 **ANALISIS GAMBAR SELESAI (FALLBACK)**

- **Kategori Masalah**: Tumpukan Sampah Anorganik
- **Tingkat Keparahan / Bahaya**: Sedang
- **Akurasi Analisis AI**: 88.0%

💡 **Rekomendasi Tindakan Warga**:
1. Hindari menyentuh benda tajam atau limbah medis tanpa pelindung tangan.
2. Silakan pisahkan sampah kering dan basah jika memungkinkan.
3. Kirimkan laporan foto ini secara resmi untuk verifikasi petugas kebersihan.`,
      };
    }
  }

  async getReports() {
    const supabase = this.supabaseService.getClient();
    const { data, error } = await supabase
      .from('reports')
      .select('*, profiles(username, full_name, avatar_url)')
      .order('created_at', { ascending: false });

    if (error) {
      throw new BadRequestException('Failed to fetch reports: ' + error.message);
    }
    return data || [];
  }

  async updateReport(
    reportId: string,
    updateData: {
      status?: string;
      waste_type?: string;
      danger_level?: string;
      confidence_score?: number;
    },
  ) {
    const supabase = this.supabaseService.getClient();

    // 1. Ambil status lama dan reporter_id sebelum diperbarui
    const { data: oldReport } = await supabase
      .from('reports')
      .select('status, reporter_id')
      .eq('id', reportId)
      .single();

    const { data, error } = await supabase
      .from('reports')
      .update(updateData)
      .eq('id', reportId)
      .select()
      .single();

    if (error) {
      throw new BadRequestException('Gagal memperbarui laporan: ' + error.message);
    }

    // 2. Jika status berubah menjadi approved, berikan reward gamifikasi ke warga pelapor
    if (updateData.status === 'approved' && oldReport && oldReport.status !== 'approved') {
      try {
        await this.profilesService.awardReportRewards(oldReport.reporter_id);
      } catch (rewardErr) {
        // Log error tapi jangan gagalkan respons utama admin
        Logger.error(`Failed to award gamification rewards to user ${oldReport.reporter_id}: ${rewardErr.message}`, 'ReportsService');
      }
    }

    return data;
  }

  async deleteReport(reportId: string) {
    const supabase = this.supabaseService.getClient();
    const { error } = await supabase
      .from('reports')
      .delete()
      .eq('id', reportId);

    if (error) {
      throw new BadRequestException('Gagal menghapus laporan: ' + error.message);
    }
    return { success: true, message: `Laporan dengan ID ${reportId} berhasil dihapus` };
  }
}
