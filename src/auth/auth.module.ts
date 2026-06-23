import { Module } from '@nestjs/common';
import { AuthController } from './auth.controller';
import { AuthGuard } from './auth.guard';
import { RolesGuard } from './roles.guard';
import { ChatThrottlerGuard } from './chat-throttler.guard';

@Module({
  controllers: [AuthController],
  providers: [AuthGuard, RolesGuard, ChatThrottlerGuard],
  exports: [AuthGuard, RolesGuard, ChatThrottlerGuard],
})
export class AuthModule {}
