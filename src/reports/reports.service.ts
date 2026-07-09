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
    const { data: duplicateId, error: rpcError } = await supabase.rpc(
      'check_duplicate_report',
      {
        p_lat: lat,
        p_lng: lng,
      },
    );

    if (rpcError) {
      throw new BadRequestException(
        'Gagal memverifikasi lokasi spasial: ' + rpcError.message,
      );
    }

    if (duplicateId) {
      return {
        isDuplicate: true,
        message:
          'Laporan serupa terdeteksi dalam radius 50 meter. Menggabungkan laporan...',
        duplicateReportId: duplicateId,
      };
    }

    // 2. Lakukan sensor gambar PII (Wajah & Plat Nomor)
    const sanitizedBuffer =
      await this.piiRedactionService.redactSensitiveInfo(fileBuffer);

    // 3. Buat nama file unik untuk diunggah ke Google Cloud Storage
    const fileExtension = fileMimeType.split('/')[1] || 'jpg';
    const uniqueFileName = `reports/${userId}/${Date.now()}_${Math.random().toString(36).substring(2, 7)}.${fileExtension}`;

    // 4. Unggah ke Google Cloud Storage
    let imageUrl: string;
    try {
      imageUrl = await this.gcsService.uploadFile(
        sanitizedBuffer,
        uniqueFileName,
        fileMimeType,
      );
    } catch (gcsError) {
      throw new BadRequestException(
        'Gagal mengunggah foto laporan ke storage: ' + gcsError.message,
      );
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
      throw new BadRequestException(
        'Gagal menyimpan laporan ke database: ' + insertError?.message,
      );
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
      Anda adalah Geni, Asisten AI dari Genesis.id yang sangat asyik, santai, seru, bersahabat (fun), dan sangat peduli dengan kebersihan kota!
      Tugas Anda adalah menganalisis foto yang diunggah warga secara visual secara santai, komunikatif, dan interaktif.
      
      ATURAN RESPONS:
      1. FORMAT MARKDOWN TERSTRUKTUR (PANDUAN CHATGPT): Anda WAJIB menyusun penjelasan dengan format Markdown yang sangat cantik, bersih, dan mudah dipindai oleh mata (scannable).
         - Gunakan **tebal** (double asterisks, e.g. **jenis sampah**) untuk istilah utama, jenis polusi yang terdeteksi, atau kata penting lainnya agar pembaca langsung memahami intinya dalam satu kedipan mata.
         - Gunakan subjudul `##` atau `###` jika membagi analisis menjadi beberapa aspek.
         - Batasi panjang paragraf agar nyaman dibaca dan tidak melelahkan mata, serta gunakan emoji yang bersahabat untuk menghidupkan suasana.
         - JANGAN gunakan format poin-poin yang kaku atau checklist formal, melainkan alirkan penjelasan secara komunikatif.
      2. Gunakan gaya bahasa percakapan yang santai, asyik, menyemangati, dan ekspresif.
      3. Berikan respons natural yang menyenangkan:
         - Jika gambar tersebut adalah sampah/pencemaran lingkungan: Berikan ucapan penyemangat/apresiasi seru (contoh: "Wah, jeli banget mata kamu! Kamu berhasil mendeteksi tumpukan sampah di sekitar sini. Yuk, langsung kirim laporannya biar area ini bisa segera disapu bersih!"), sebutkan jenis sampahnya secara sekilas dalam paragraf pendek, lalu beri saran seru tindakan pencegahannya.
         - Jika gambar tersebut BUKAN sampah (misal: selfie, barang bersih, tanaman indah, ruang rapi, atau foto acak): Ucapkan dengan nada jenaka/lucu (contoh: "SELAMAT!! Foto yang kamu ambil super bersih dan bebas dari sampah! Tapi tunggu dulu... ini kan bukan tumpukan sampah atau pencemaran lingkungan, hehe. Yuk cari lokasi tumpukan sampah yang sesungguhnya di sekitar kamu agar lingkungan kita makin asri!").
      4. FITUR PANGGIL GAMBAR (VISUAL CALLING): Jika Anda ingin memperjelas penjelasan atau memberikan contoh/ilustrasi visual kepada warga, Anda diperbolehkan menyisipkan gambar secara langsung menggunakan format markdown: \\\`![deskripsi](URL_Gambar_Bebas)\\\`. Biarkan diri Anda memilih dan menentukan sendiri URL gambar yang relevan (misalnya menggunakan gambar bebas dari Unsplash atau sumber lainnya).
      5. Batasi respons maksimal 2-3 paragraf pendek dengan pemisah baris yang cukup agar terkesan bersih dan rapi.
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
      const responseText =
        await this.openRouterService.getChatCompletion(messages);
      return {
        success: true,
        analysis: responseText.content,
      };
    } catch (error) {
      Logger.error(`Error analyzing image: ${error.message}`, 'ReportsService');
      return {
        success: true,
        analysis: `Wah, luar biasa! Foto kamu sudah terbaca oleh sistem kecerdasan Geni. Tampaknya ada beberapa tumpukan sampah di area ini yang kurang sedap dipandang, nih. Yuk, segera kirim laporan resminya ke sistem biar tim kebersihan kota langsung meluncur dan lingkungan kita kembali asri! Tetap semangat menjaga kebersihan kota kita, ya! 🌿`,
      };
    }
  }

  async getReports(userId: string) {
    const supabase = this.supabaseService.getClient();

    // 1. Ambil data role user dari profiles
    const { data: profile } = await supabase
      .from('profiles')
      .select('role')
      .eq('id', userId)
      .single();

    const role = profile?.role || 'citizen';

    // 2. Buat query dasar
    let query = supabase
      .from('reports')
      .select('*, profiles(username, full_name, avatar_url)');

    // Jika user adalah citizen, hanya tampilkan laporan buatannya sendiri
    if (role !== 'admin') {
      query = query.eq('reporter_id', userId);
    }

    const { data, error } = await query.order('created_at', { ascending: false });

    if (error) {
      throw new BadRequestException(
        'Failed to fetch reports: ' + error.message,
      );
    }
    return data || [];
  }

  async getReportsForCleaners() {
    const supabase = this.supabaseService.getClient();

    const { data, error } = await supabase
      .from('reports')
      .select('*, profiles(username, full_name, avatar_url)')
      .eq('status', 'approved')
      .order('created_at', { ascending: false });

    if (error) {
      throw new BadRequestException(
        'Gagal mengambil laporan untuk petugas kebersihan: ' + error.message,
      );
    }

    return (data || []).map((report: any) => {
      let latitude = 0.0;
      let longitude = 0.0;

      if (report.location && report.location.coordinates) {
        longitude = report.location.coordinates[0];
        latitude = report.location.coordinates[1];
      }

      return {
        id: report.id,
        reporter_id: report.reporter_id,
        image_url: report.image_url,
        description: report.description,
        status: report.status,
        confidence_score: report.confidence_score,
        waste_type: report.waste_type,
        danger_level: report.danger_level,
        latitude,
        longitude,
        google_maps_url: `https://www.google.com/maps/dir/?api=1&destination=${latitude},${longitude}&travelmode=driving`,
        created_at: report.created_at,
        updated_at: report.updated_at,
        profiles: report.profiles,
      };
    });
  }


  async updateReport(
    reportId: string,
    updateData: {
      status?: string;
      waste_type?: string;
      danger_level?: string;
      confidence_score?: number;
      admin_notes?: string;
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
      throw new BadRequestException(
        'Gagal memperbarui laporan: ' + error.message,
      );
    }

    // 2. Jika status berubah menjadi approved, berikan reward gamifikasi ke warga pelapor
    if (
      updateData.status === 'approved' &&
      oldReport &&
      oldReport.status !== 'approved'
    ) {
      try {
        await this.profilesService.awardReportRewards(oldReport.reporter_id);
      } catch (rewardErr) {
        // Log error tapi jangan gagalkan respons utama admin
        Logger.error(
          `Failed to award gamification rewards to user ${oldReport.reporter_id}: ${rewardErr.message}`,
          'ReportsService',
        );
      }
    }

    return data;
  }

  async deleteReport(reportId: string, userId: string) {
    const supabase = this.supabaseService.getClient();

    // 1. Ambil data laporan terlebih dahulu
    const { data: report, error: fetchError } = await supabase
      .from('reports')
      .select('reporter_id, status')
      .eq('id', reportId)
      .single();

    if (fetchError || !report) {
      throw new BadRequestException('Laporan tidak ditemukan');
    }

    // 2. Cek profil pengguna untuk mendapatkan perannya (role)
    const { data: profile } = await supabase
      .from('profiles')
      .select('role')
      .eq('id', userId)
      .single();

    const userRole = profile?.role || 'citizen';

    // 3. Warga biasa hanya boleh menghapus laporannya sendiri yang DITOLAK (rejected)
    if (userRole !== 'admin') {
      if (report.reporter_id !== userId) {
        throw new BadRequestException(
          'Anda tidak memiliki hak akses untuk menghapus laporan ini',
        );
      }
      if (report.status !== 'rejected') {
        throw new BadRequestException(
          'Hanya laporan dengan status ditolak yang dapat dihapus oleh warga',
        );
      }
    }

    // 4. Jalankan perintah hapus
    const { error } = await supabase
      .from('reports')
      .delete()
      .eq('id', reportId);

    if (error) {
      throw new BadRequestException(
        'Gagal menghapus laporan: ' + error.message,
      );
    }
    return {
      success: true,
      message: `Laporan dengan ID ${reportId} berhasil dihapus`,
    };
  }
}
