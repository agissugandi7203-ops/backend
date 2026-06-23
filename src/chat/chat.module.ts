import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { ChatService } from './chat.service';
import { ChatController } from './chat.controller';

@Module({
  imports: [AuthModule],
  providers: [ChatService],
  controllers: [ChatController],
  exports: [ChatService],
})
export class ChatModule {}
