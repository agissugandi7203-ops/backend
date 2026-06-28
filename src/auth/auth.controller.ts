import { Controller, Get, UseGuards } from '@nestjs/common';
import { AuthGuard } from './auth.guard';
import { GetUser } from './get-user.decorator';
import type { User } from '@supabase/supabase-js';
import { ApiTags, ApiOperation, ApiResponse, ApiBearerAuth } from '@nestjs/swagger';

@ApiTags('Autentikasi & Verifikasi Token')
@Controller('auth')
export class AuthController {
  @Get('verify')
  @UseGuards(AuthGuard)
  @ApiBearerAuth('JWT-auth')
  @ApiOperation({
    summary: 'Verifikasi Token JWT Supabase',
    description: 'Memverifikasi status login pengguna menggunakan token JWT Supabase aktif di header Authorization.',
  })
  @ApiResponse({ status: 200, description: 'Token valid dan pengguna terautentikasi.' })
  @ApiResponse({ status: 401, description: 'Token tidak lengkap, kedaluwarsa, atau tidak valid.' })
  verifyToken(@GetUser() user: any) {
    const currentUser = user as User;
    return {
      authenticated: true,
      message: 'Token authentication successful',
      user: {
        id: currentUser.id,
        email: currentUser.email,
      },
    };
  }
}
