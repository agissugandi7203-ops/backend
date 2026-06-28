import { Body, Controller, Delete, Get, Post, UseGuards } from '@nestjs/common';
import { AuthGuard } from '../auth/auth.guard';
import { RolesGuard } from '../auth/roles.guard';
import { Roles } from '../auth/roles.decorator';
import { BadgesService } from './badges.service';
import { ApiTags, ApiOperation, ApiResponse, ApiBearerAuth, ApiBody } from '@nestjs/swagger';

@ApiTags('Pengelolaan Lencana (Badges)')
@ApiBearerAuth('JWT-auth')
@Controller('badges')
@UseGuards(AuthGuard)
export class BadgesController {
  constructor(private readonly badgesService: BadgesService) {}

  @Get()
  @ApiOperation({
    summary: 'Ambil Semua Lencana Terdaftar',
    description: 'Menampilkan seluruh daftar lencana (badge) yang tersedia di database Genesis.id beserta deskripsi dan syarat perolehannya.',
  })
  @ApiResponse({ status: 200, description: 'Daftar lencana berhasil diambil.' })
  @ApiResponse({ status: 401, description: 'Pengguna tidak terautentikasi.' })
  getAllBadges() {
    return this.badgesService.getAllBadges();
  }

  // --- Kontrol Lencana Khusus Admin ---

  @Post('award')
  @UseGuards(RolesGuard)
  @Roles('admin')
  @ApiOperation({
    summary: 'Berikan Lencana ke Pengguna (Admin Only)',
    description: 'Menyematkan lencana baru kepada profil pengguna berdasarkan userId dan kode lencana (badge_code). Hanya dapat dijalankan oleh Administrator.',
  })
  @ApiBody({
    schema: {
      type: 'object',
      properties: {
        userId: { type: 'string', description: 'ID Pengguna di tabel profiles' },
        badgeCode: { type: 'string', description: 'Kode unik lencana (e.g. eco_warrior, zero_waste)' },
      },
      required: ['userId', 'badgeCode'],
    }
  })
  @ApiResponse({ status: 201, description: 'Lencana berhasil disematkan.' })
  @ApiResponse({ status: 403, description: 'Akses ditolak (Bukan Administrator).' })
  awardBadge(
    @Body('userId') userId: string,
    @Body('badgeCode') badgeCode: string,
  ) {
    return this.badgesService.awardBadge(userId, badgeCode);
  }

  @Delete('revoke')
  @UseGuards(RolesGuard)
  @Roles('admin')
  @ApiOperation({
    summary: 'Cabut Lencana Pengguna (Admin Only)',
    description: 'Mencabut kepemilikan lencana tertentu dari profil pengguna. Hanya dapat dijalankan oleh Administrator.',
  })
  @ApiBody({
    schema: {
      type: 'object',
      properties: {
        userId: { type: 'string', description: 'ID Pengguna di tabel profiles' },
        badgeCode: { type: 'string', description: 'Kode unik lencana yang ingin dicabut' },
      },
      required: ['userId', 'badgeCode'],
    }
  })
  @ApiResponse({ status: 200, description: 'Lencana berhasil dicabut.' })
  @ApiResponse({ status: 403, description: 'Akses ditolak (Bukan Administrator).' })
  revokeBadge(
    @Body('userId') userId: string,
    @Body('badgeCode') badgeCode: string,
  ) {
    return this.badgesService.revokeBadge(userId, badgeCode);
  }
}
