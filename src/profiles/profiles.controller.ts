import {
  Body,
  Controller,
  Get,
  Delete,
  Param,
  Patch,
  Post,
  UseGuards,
  UsePipes,
  ValidationPipe,
} from '@nestjs/common';
import { AuthGuard } from '../auth/auth.guard';
import { RolesGuard } from '../auth/roles.guard';
import { Roles } from '../auth/roles.decorator';
import { GetUser } from '../auth/get-user.decorator';
import { ProfilesService } from './profiles.service';
import { OnboardProfileDto } from './dto/onboard-profile.dto';
import { AdjustGamificationDto } from './dto/adjust-gamification.dto';
import { ApiTags, ApiOperation, ApiResponse, ApiBearerAuth, ApiParam, ApiBody } from '@nestjs/swagger';

@ApiTags('Profil Pengguna (Profiles)')
@ApiBearerAuth('JWT-auth')
@Controller('profiles')
@UseGuards(AuthGuard)
export class ProfilesController {
  constructor(private readonly profilesService: ProfilesService) {}

  @Get('me')
  @ApiOperation({
    summary: 'Ambil Profil Saya',
    description: 'Menampilkan detail data profil pengguna yang sedang login beserta level, XP, streak, dan lencana yang telah diperoleh.',
  })
  @ApiResponse({ status: 200, description: 'Detail profil sukses diambil.' })
  @ApiResponse({ status: 401, description: 'Pengguna belum terautentikasi.' })
  getProfile(@GetUser('id') userId: string) {
    return this.profilesService.getProfile(userId);
  }

  @Post('onboard')
  @UsePipes(new ValidationPipe({ whitelist: true }))
  @ApiOperation({
    summary: 'Onboarding Profil Pengguna Baru',
    description: 'Melengkapi informasi registrasi awal pengguna baru seperti username, nama lengkap, nomor telepon, dan domisili kota/provinsi.',
  })
  @ApiBody({ type: OnboardProfileDto })
  @ApiResponse({ status: 201, description: 'Onboarding profil berhasil disimpan.' })
  @ApiResponse({ status: 400, description: 'Format input tidak valid.' })
  onboard(
    @GetUser('id') userId: string,
    @Body() onboardDto: OnboardProfileDto,
  ) {
    return this.profilesService.onboard(userId, onboardDto);
  }

  // --- Endpoint Khusus Admin ---

  @Get()
  @UseGuards(RolesGuard)
  @Roles('admin')
  @ApiOperation({
    summary: 'Ambil Semua Profil Pengguna (Admin Only)',
    description: 'Menampilkan seluruh daftar profil pengguna yang terdaftar di sistem. Hanya dapat diakses oleh Administrator.',
  })
  @ApiResponse({ status: 200, description: 'Daftar semua profil berhasil diambil.' })
  @ApiResponse({ status: 403, description: 'Akses ditolak.' })
  getAllProfiles() {
    return this.profilesService.getAllProfiles();
  }

  @Delete(':id')
  @UseGuards(RolesGuard)
  @Roles('admin')
  @ApiOperation({
    summary: 'Hapus Profil Pengguna (Admin Only)',
    description: 'Menghapus akun dan seluruh data profil pengguna dari database berdasarkan ID pengguna. Hanya dapat dijalankan oleh Administrator.',
  })
  @ApiParam({ name: 'id', description: 'ID pengguna yang ingin dihapus' })
  @ApiResponse({ status: 200, description: 'Profil pengguna berhasil dihapus.' })
  @ApiResponse({ status: 403, description: 'Akses ditolak.' })
  deleteProfile(@Param('id') userId: string) {
    return this.profilesService.deleteProfile(userId);
  }

  @Patch(':id/gamification')
  @UseGuards(RolesGuard)
  @Roles('admin')
  @UsePipes(new ValidationPipe({ whitelist: true }))
  @ApiOperation({
    summary: 'Koreksi Data Gamifikasi Pengguna (Admin Only)',
    description: 'Menyesuaikan nilai XP, Level, Streak, atau Poin pengguna secara manual untuk keperluan koreksi data atau reward khusus. Hanya dapat dilakukan oleh Administrator.',
  })
  @ApiParam({ name: 'id', description: 'ID pengguna yang ingin disesuaikan gamifikasinya' })
  @ApiBody({ type: AdjustGamificationDto })
  @ApiResponse({ status: 200, description: 'Nilai gamifikasi sukses diperbarui.' })
  @ApiResponse({ status: 403, description: 'Akses ditolak.' })
  adjustGamification(
    @Param('id') userId: string,
    @Body() adjustDto: AdjustGamificationDto,
  ) {
    return this.profilesService.adjustGamification(userId, adjustDto);
  }
}
