import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { ApiKeyGuard } from './api-key.guard';
import { B2gService } from './b2g.service';
import {
  ApiTags,
  ApiOperation,
  ApiHeader,
  ApiQuery,
  ApiResponse,
} from '@nestjs/swagger';

@ApiTags('B2G (Data-as-a-Service)')
@Controller('b2g')
@UseGuards(ApiKeyGuard)
@ApiHeader({
  name: 'x-api-key',
  description: 'Kunci API Trial/Pemerintah untuk autentikasi layanan DaaS',
  required: true,
  schema: { default: 'genesis_trial_key_2026' },
})
export class B2gController {
  constructor(private readonly b2gService: B2gService) {}

  @Get('reports')
  @ApiOperation({
    summary: 'Ambil Laporan Spasial Lingkungan B2G',
    description: 'Endpoint khusus instansi pemerintah untuk menarik data spasial laporan tumpukan sampah, bencana lingkungan, dan tingkat keparahan wilayah secara real-time dalam format koordinat GIS.',
  })
  @ApiQuery({ name: 'city_or_district', required: false, description: 'Saring berdasarkan nama Kota atau Kabupaten (e.g. "Kota Surabaya")' })
  @ApiQuery({ name: 'status', required: false, enum: ['pending_ai', 'approved', 'resolved', 'rejected'], description: 'Saring berdasarkan status penanganan laporan' })
  @ApiQuery({ name: 'waste_type', required: false, description: 'Saring berdasarkan jenis sampah terdeteksi AI (e.g. "Plastik", "Organik")' })
  @ApiQuery({ name: 'danger_level', required: false, enum: ['Rendah', 'Sedang', 'Tinggi'], description: 'Saring berdasarkan tingkat bahaya' })
  @ApiQuery({ name: 'limit', required: false, schema: { type: 'integer', default: 20 }, description: 'Batasi jumlah data (maksimal 100)' })
  @ApiResponse({ status: 200, description: 'Data laporan berhasil ditarik.' })
  @ApiResponse({ status: 401, description: 'Kunci API (x-api-key) tidak lengkap atau tidak valid.' })
  getReports(
    @Query('city_or_district') cityOrDistrict?: string,
    @Query('status') status?: string,
    @Query('waste_type') wasteType?: string,
    @Query('danger_level') dangerLevel?: string,
    @Query('limit') limit?: number,
  ) {
    return this.b2gService.getReports({
      city_or_district: cityOrDistrict,
      status,
      waste_type: wasteType,
      danger_level: dangerLevel,
      limit: limit ? Number(limit) : undefined,
    });
  }

  @Get('summary')
  @ApiOperation({
    summary: 'Ringkasan Statistik Spasial Wilayah',
    description: 'Menyediakan ringkasan data statistik jumlah sampah, tingkat bahaya, dan sebaran status laporan per wilayah untuk konsumsi dashboard GIS pimpinan.',
  })
  @ApiQuery({ name: 'city_or_district', required: false, description: 'Saring ringkasan statistik hanya untuk Kota/Kabupaten tertentu' })
  @ApiResponse({ status: 200, description: 'Ringkasan data berhasil disusun.' })
  @ApiResponse({ status: 401, description: 'Kunci API (x-api-key) tidak lengkap atau tidak valid.' })
  getSummary(@Query('city_or_district') cityOrDistrict?: string) {
    return this.b2gService.getSummary(cityOrDistrict);
  }
}
