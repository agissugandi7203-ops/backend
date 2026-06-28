import {
  Controller,
  Post,
  Req,
  Get,
  Patch,
  Delete,
  Param,
  Body,
  UseGuards,
  UsePipes,
  ValidationPipe,
  BadRequestException,
} from '@nestjs/common';
import { AuthGuard } from '../auth/auth.guard';
import { RolesGuard } from '../auth/roles.guard';
import { Roles } from '../auth/roles.decorator';
import { GetUser } from '../auth/get-user.decorator';
import { ReportsService } from './reports.service';
import { FastifyRequest } from 'fastify';
import { UpdateReportDto } from './dto/update-report.dto';
import { ApiTags, ApiOperation, ApiResponse, ApiBearerAuth, ApiParam, ApiBody, ApiConsumes } from '@nestjs/swagger';

@ApiTags('Laporan Penemuan Sampah (Reports)')
@ApiBearerAuth('JWT-auth')
@Controller('reports')
@UseGuards(AuthGuard)
export class ReportsController {
  constructor(private readonly reportsService: ReportsService) {}

  @Post('analyze')
  @ApiConsumes('multipart/form-data')
  @ApiOperation({
    summary: 'Analisis AI Citra Sampah (Pra-Laporan)',
    description: 'Mengunggah foto tumpukan sampah untuk dianalisis oleh AI (menggunakan Gemini/Vision) guna mendeteksi jenis sampah secara otomatis dan menentukan tingkat keparahan sebelum laporan resmi dibuat.',
  })
  @ApiBody({
    schema: {
      type: 'object',
      properties: {
        file: { type: 'string', format: 'binary', description: 'File gambar tumpukan sampah' },
      },
      required: ['file'],
    }
  })
  @ApiResponse({ status: 201, description: 'Analisis citra berhasil.' })
  @ApiResponse({ status: 400, description: 'Format request salah atau file tidak diunggah.' })
  async analyzeReportImage(@Req() req: any) {
    const fastifyReq = req as FastifyRequest;
    if (!fastifyReq.isMultipart()) {
      throw new BadRequestException(
        'Format request harus berupa multipart/form-data',
      );
    }

    const fileData = await fastifyReq.file();
    if (!fileData) {
      throw new BadRequestException('Berkas foto laporan wajib diunggah');
    }

    const fileBuffer = await fileData.toBuffer();
    return this.reportsService.analyzeImage(fileBuffer, fileData.mimetype);
  }

  @Post()
  @ApiConsumes('multipart/form-data')
  @ApiOperation({
    summary: 'Kirim Laporan Sampah Baru',
    description: 'Mengirimkan laporan penemuan tumpukan sampah baru beserta koordinat lokasi geospasial (latitude, longitude), deskripsi, dan foto bukti pendukung.',
  })
  @ApiBody({
    schema: {
      type: 'object',
      properties: {
        file: { type: 'string', format: 'binary', description: 'Foto sampah penemuan' },
        latitude: { type: 'number', format: 'float', description: 'Garis lintang lokasi penemuan' },
        longitude: { type: 'number', format: 'float', description: 'Garis bujur lokasi penemuan' },
        description: { type: 'string', description: 'Keterangan tambahan laporan' },
      },
      required: ['file', 'latitude', 'longitude'],
    }
  })
  @ApiResponse({ status: 201, description: 'Laporan berhasil terdaftar.' })
  @ApiResponse({ status: 400, description: 'Format input tidak lengkap atau salah.' })
  async uploadReport(@Req() req: any, @GetUser('id') userId: string) {
    const fastifyReq = req as FastifyRequest;
    // 1. Cek apakah format request berupa multipart
    if (!fastifyReq.isMultipart()) {
      throw new BadRequestException(
        'Format request harus berupa multipart/form-data',
      );
    }

    // 2. Ambil berkas berkas file
    const fileData = await fastifyReq.file();
    if (!fileData) {
      throw new BadRequestException('Berkas foto laporan wajib diunggah');
    }

    const fileBuffer = await fileData.toBuffer();

    // 3. Ekstrak data field non-file (latitude, longitude, description)
    const latField = fileData.fields.latitude;
    const lngField = fileData.fields.longitude;
    const descField = fileData.fields.description;

    if (!latField || !lngField) {
      throw new BadRequestException('Field latitude dan longitude wajib diisi');
    }

    const lat = parseFloat((latField as any).value);
    const lng = parseFloat((lngField as any).value);
    const description = (descField as any)?.value;

    if (isNaN(lat) || isNaN(lng)) {
      throw new BadRequestException(
        'Latitude dan longitude harus berupa angka desimal yang valid',
      );
    }

    return this.reportsService.createReport(
      userId,
      fileBuffer,
      fileData.mimetype,
      lat,
      lng,
      description,
    );
  }

  @Get('cleaners')
  @ApiOperation({
    summary: 'Ambil Laporan Aktif Bagi Tim Cleaner (Penyapu)',
    description: 'Menarik daftar tumpukan sampah tervalidasi yang siap dibersihkan oleh petugas kebersihan/tim cleaner.',
  })
  @ApiResponse({ status: 200, description: 'Daftar tugas pembersihan berhasil dimuat.' })
  getReportsForCleaners() {
    return this.reportsService.getReportsForCleaners();
  }

  @Get()
  @ApiOperation({
    summary: 'Ambil Riwayat Laporan Saya',
    description: 'Menarik riwayat laporan penemuan sampah yang pernah dikirimkan oleh akun pengguna bersangkutan beserta status penanganannya.',
  })
  @ApiResponse({ status: 200, description: 'Riwayat laporan berhasil diambil.' })
  getReports(@GetUser('id') userId: string) {
    return this.reportsService.getReports(userId);
  }

  // --- Endpoint Khusus Admin ---

  @Patch(':id')
  @UseGuards(RolesGuard)
  @Roles('admin')
  @UsePipes(new ValidationPipe({ whitelist: true }))
  @ApiOperation({
    summary: 'Verifikasi & Perbarui Status Laporan (Admin Only)',
    description: 'Memperbarui status penanganan laporan (e.g. approved, rejected, resolved) beserta catatan dari tim admin. Hanya dapat dilakukan oleh Administrator.',
  })
  @ApiParam({ name: 'id', description: 'ID Laporan yang ingin diperbarui' })
  @ApiBody({ type: UpdateReportDto })
  @ApiResponse({ status: 200, description: 'Laporan sukses diperbarui.' })
  @ApiResponse({ status: 403, description: 'Akses ditolak.' })
  updateReport(
    @Param('id') reportId: string,
    @Body() updateDto: UpdateReportDto,
  ) {
    return this.reportsService.updateReport(reportId, updateDto);
  }

  @Delete(':id')
  @ApiOperation({
    summary: 'Batalkan / Hapus Laporan',
    description: 'Menghapus laporan sampah jika laporan tersebut dikirimkan oleh pembuat bersangkutan.',
  })
  @ApiParam({ name: 'id', description: 'ID Laporan yang ingin dihapus' })
  @ApiResponse({ status: 200, description: 'Laporan berhasil dihapus.' })
  deleteReport(@Param('id') reportId: string, @GetUser('id') userId: string) {
    return this.reportsService.deleteReport(reportId, userId);
  }
}
