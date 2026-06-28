import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { AuthGuard } from '../auth/auth.guard';
import { LeaderboardService } from './leaderboard.service';
import { ApiTags, ApiOperation, ApiResponse, ApiBearerAuth, ApiQuery } from '@nestjs/swagger';

@ApiTags('Peringkat & Papan Skor (Leaderboard)')
@ApiBearerAuth('JWT-auth')
@Controller('leaderboard')
@UseGuards(AuthGuard)
export class LeaderboardController {
  constructor(private readonly leaderboardService: LeaderboardService) {}

  @Get('global')
  @ApiOperation({
    summary: 'Ambil Papan Skor Global Warga',
    description: 'Menyajikan daftar peringkat (leaderboard) warga secara global berdasarkan perolehan XP, dengan filter opsional wilayah kota atau provinsi.',
  })
  @ApiQuery({ name: 'limit', required: false, schema: { type: 'integer', default: 100 }, description: 'Jumlah baris peringkat yang ingin ditampilkan' })
  @ApiQuery({ name: 'city', required: false, description: 'Saring peringkat berdasarkan Kota/Kabupaten tertentu' })
  @ApiQuery({ name: 'province', required: false, description: 'Saring peringkat berdasarkan Provinsi tertentu' })
  @ApiResponse({ status: 200, description: 'Papan skor global berhasil diambil.' })
  getGlobalLeaderboard(
    @Query('limit') limit?: number,
    @Query('city') city?: string,
    @Query('province') province?: string,
  ) {
    const limitVal = limit ? Number(limit) : 100;
    return this.leaderboardService.getGlobalLeaderboard(
      limitVal,
      city,
      province,
    );
  }

  @Get('city')
  @ApiOperation({
    summary: 'Ambil Papan Skor Berdasarkan Kota Terbersih',
    description: 'Menyajikan statistik sebaran kontribusi kebersihan daerah/kota dengan agregasi total aksi warga dan total sampah yang berhasil dikumpulkan.',
  })
  @ApiQuery({ name: 'limit', required: false, schema: { type: 'integer', default: 100 }, description: 'Jumlah baris kota yang ingin ditampilkan' })
  @ApiResponse({ status: 200, description: 'Papan skor kota berhasil disusun.' })
  getCityLeaderboard(@Query('limit') limit?: number) {
    const limitVal = limit ? Number(limit) : 100;
    return this.leaderboardService.getCityLeaderboard(limitVal);
  }
}
