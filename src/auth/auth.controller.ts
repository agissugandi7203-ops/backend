import { Controller, Get, UseGuards } from '@nestjs/common';
import { AuthGuard } from './auth.guard';
import { GetUser } from './get-user.decorator';
import type { User } from '@supabase/supabase-js';

@Controller('auth')
export class AuthController {
  @Get('verify')
  @UseGuards(AuthGuard)
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
