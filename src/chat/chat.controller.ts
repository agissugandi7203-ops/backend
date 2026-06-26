import {
  Controller,
  Post,
  Body,
  UseGuards,
  Res,
  HttpStatus,
  HttpException,
} from '@nestjs/common';
import { AuthGuard } from '../auth/auth.guard';
import { ChatThrottlerGuard } from '../auth/chat-throttler.guard';
import { ChatService } from './chat.service';
import { ChatRequestDto } from './dto/chat-request.dto';
import type { FastifyReply } from 'fastify';

@Controller('chat')
@UseGuards(AuthGuard, ChatThrottlerGuard)
export class ChatController {
  constructor(private readonly chatService: ChatService) {}

  /**
   * Endpoint Chat Warga Instan (Menerima jawaban lengkap sekaligus)
   */
  @Post()
  async instantChat(@Body() dto: ChatRequestDto) {
    return this.chatService.processChat(dto);
  }

  /**
   * Endpoint Chat Warga Streaming (Menerima jawaban karakter demi karakter lewat Server-Sent Events)
   */
  @Post('stream')
  async streamingChat(@Body() dto: ChatRequestDto, @Res() reply: any) {
    const response = await this.chatService.processChatStream(dto);

    if (!response.body) {
      throw new HttpException(
        'Gagal mendapatkan aliran data dari OpenRouter API',
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }

    // Set header Fastify untuk Server-Sent Events (SSE)
    reply.raw.writeHead(HttpStatus.OK, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
      'Access-Control-Allow-Origin': '*',
    });

    const reader = response.body.getReader();
    const decoder = new TextDecoder();

    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) {
          break;
        }

        // Decode binary chunk ke string teks UTF-8
        const textChunk = decoder.decode(value, { stream: true });

        // Tulis langsung ke socket client raw reply Fastify
        reply.raw.write(textChunk);
      }
    } catch (err) {
      // Jika terjadi pemutusan koneksi di tengah jalan, log error
      reply.raw.write(`\ndata: [ERROR] Stream interrupted: ${err.message}\n\n`);
    } finally {
      // Pastikan stream ditutup bersih
      reply.raw.write('data: [DONE]\n\n');
      reply.raw.end();
    }
  }

  /**
   * Endpoint Transkripsi Audio Speech-To-Text (OpenRouter API)
   */
  @Post('transcribe')
  async transcribeAudio(
    @Body('audio') base64Audio: string,
    @Body('format') format: string,
    @Body('model') model?: string,
  ) {
    return this.chatService.transcribeAudio(base64Audio, format, model);
  }
}
