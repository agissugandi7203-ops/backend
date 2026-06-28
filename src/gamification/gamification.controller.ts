import { Controller, Get, Post, Body, UseGuards } from '@nestjs/common';
import { AuthGuard } from '../auth/auth.guard';
import { RolesGuard } from '../auth/roles.guard';
import { Roles } from '../auth/roles.decorator';
import { GetUser } from '../auth/get-user.decorator';
import { GamificationService } from './gamification.service';
import { ApiTags, ApiOperation, ApiResponse, ApiBearerAuth, ApiBody } from '@nestjs/swagger';

@ApiTags('Gamifikasi & Tantangan (Gamification)')
@ApiBearerAuth('JWT-auth')
@Controller('gamification')
@UseGuards(AuthGuard)
export class GamificationController {
  constructor(private readonly gamificationService: GamificationService) {}

  @Post('events')
  @UseGuards(RolesGuard)
  @Roles('admin')
  @ApiOperation({
    summary: 'Buat Event Gamifikasi Baru (Admin Only)',
    description: 'Membuat event berhadiah XP/Poin baru bagi warga yang berpartisipasi aktif menjaga kebersihan lingkungan. Hanya dapat diakses oleh Administrator.',
  })
  @ApiBody({
    schema: {
      type: 'object',
      properties: {
        title: { type: 'string', description: 'Judul event gamifikasi' },
        description: { type: 'string', description: 'Deskripsi lengkap event' },
        points: { type: 'number', description: 'Jumlah poin/XP yang didapat jika berpartisipasi' },
      },
      required: ['title', 'description', 'points'],
    }
  })
  @ApiResponse({ status: 201, description: 'Event gamifikasi berhasil dibuat.' })
  @ApiResponse({ status: 403, description: 'Akses ditolak (Bukan Administrator).' })
  createEvent(
    @Body('title') title: string,
    @Body('description') description: string,
    @Body('points') points: number,
  ) {
    const pointsVal = points ? Number(points) : 0;
    return this.gamificationService.createEvent(title, description, pointsVal);
  }

  @Get('events')
  @ApiOperation({
    summary: 'Ambil Semua Event Gamifikasi',
    description: 'Menampilkan seluruh daftar event berhadiah aktif yang dapat diikuti warga untuk mengumpulkan lencana dan menaikkan level.',
  })
  @ApiResponse({ status: 200, description: 'Daftar event berhasil diambil.' })
  getEvents() {
    return this.gamificationService.getEvents();
  }

  @Get('notifications')
  @ApiOperation({
    summary: 'Ambil Notifikasi Gamifikasi Pengguna',
    description: 'Menarik riwayat notifikasi pencapaian, level up, dan lencana baru khusus bagi pengguna yang sedang login.',
  })
  @ApiResponse({ status: 200, description: 'Notifikasi berhasil diambil.' })
  getNotifications(@GetUser('id') userId: string) {
    return this.gamificationService.getNotifications(userId);
  }

  @Get('challenges')
  @ApiOperation({
    summary: 'Ambil Tantangan Harian Pengguna',
    description: 'Menampilkan daftar tantangan kebersihan harian (daily challenges) beserta status penyelesaiannya untuk pengguna bersangkutan.',
  })
  @ApiResponse({ status: 200, description: 'Daftar tantangan harian berhasil disusun.' })
  getDailyChallenges(@GetUser('id') userId: string) {
    return this.gamificationService.getDailyChallenges(userId);
  }

  @Post('challenges/complete')
  @ApiOperation({
    summary: 'Selesaikan Tantangan Harian',
    description: 'Mengklaim hadiah XP/Poin atas keberhasilan menyelesaikan misi/tantangan harian tertentu menggunakan kode tantangan (challenge code).',
  })
  @ApiBody({
    schema: {
      type: 'object',
      properties: {
        code: { type: 'string', description: 'Kode tantangan yang diselesaikan (e.g. daily_report, share_impact)' }
      },
      required: ['code'],
    }
  })
  @ApiResponse({ status: 201, description: 'Klaim hadiah tantangan sukses.' })
  completeChallenge(@GetUser('id') userId: string, @Body('code') code: string) {
    return this.gamificationService.completeChallenge(userId, code);
  }
}
