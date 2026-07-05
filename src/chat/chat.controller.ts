import {
  Controller,
  Post,
  Body,
  UseGuards,
  Res,
  HttpStatus,
  HttpException,
  Req,
} from '@nestjs/common';
import { AuthGuard } from '../auth/auth.guard';
import { ChatThrottlerGuard } from '../auth/chat-throttler.guard';
import { ChatService } from './chat.service';
import { ChatRequestDto } from './dto/chat-request.dto';
import type { FastifyReply } from 'fastify';
import { ApiTags, ApiOperation, ApiResponse, ApiBearerAuth, ApiBody } from '@nestjs/swagger';

@ApiTags('Chatbot RAG (Ask AI)')
@ApiBearerAuth('JWT-auth')
@Controller('chat')
@UseGuards(AuthGuard, ChatThrottlerGuard)
export class ChatController {
  constructor(private readonly chatService: ChatService) {}

  /**
   * Endpoint Chat Warga Instan (Menerima jawaban lengkap sekaligus)
   */
  @Post()
  @ApiOperation({
    summary: 'Chat Warga Instan',
    description: 'Mengajukan pertanyaan interaktif kepada Chatbot RAG Genesis.id untuk mendapatkan respon lengkap secara langsung (non-streaming) mengenai regulasi sampah dan pelaporan.',
  })
  @ApiBody({ type: ChatRequestDto })
  @ApiResponse({ status: 201, description: 'Respon chatbot berhasil disusun.' })
  @ApiResponse({ status: 401, description: 'Pengguna tidak terautentikasi.' })
  @ApiResponse({ status: 429, description: 'Batas limitasi pesan tercapai (Throttled).' })
  async instantChat(@Body() dto: ChatRequestDto, @Req() req: any) {
    return this.chatService.processChat(dto, req.user.id);
  }

  /**
   * Endpoint Chat Warga Streaming (Menerima jawaban karakter demi karakter lewat Server-Sent Events)
   */
  @Post('stream')
  @ApiOperation({
    summary: 'Chat Warga Streaming (SSE)',
    description: 'Mengajukan pertanyaan interaktif dengan respon karakter demi karakter secara real-time lewat Server-Sent Events (SSE). Cocok untuk antarmuka chat bergaya interaktif modern.',
  })
  @ApiBody({ type: ChatRequestDto })
  @ApiResponse({ status: 201, description: 'Streaming SSE dimulai.' })
  @ApiResponse({ status: 401, description: 'Pengguna tidak terautentikasi.' })
  @ApiResponse({ status: 429, description: 'Batas limitasi pesan tercapai.' })
  async streamingChat(@Body() dto: ChatRequestDto, @Res() reply: any, @Req() req: any) {
    const response = await this.chatService.processChatStream(dto, req.user.id);

    if (!response.body) {
      throw new HttpException(
        'Gagal mendapatkan aliran data dari OpenRouter API',
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }

    // Set header Fastify untuk Server-Sent Events (SSE)
    reply.raw.writeHead(HttpStatus.OK, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-transform',
      'X-Accel-Buffering': 'no',
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
  @ApiOperation({
    summary: 'Transkripsi Audio Speech-to-Text (STT)',
    description: 'Mentranskripsi rekaman audio suara warga (dalam format base64) menjadi teks interaktif menggunakan API transkripsi pintar di OpenRouter.',
  })
  @ApiBody({
    schema: {
      type: 'object',
      properties: {
        audio: { type: 'string', description: 'Rekaman audio yang dienkode dalam bentuk Base64' },
        format: { type: 'string', description: 'Format file audio (e.g. mp3, m4a, wav)' },
        model: { type: 'string', description: 'Model transkripsi opsional (e.g. whisper-large-v3)' },
      },
      required: ['audio', 'format'],
    }
  })
  @ApiResponse({ status: 201, description: 'Transkripsi audio berhasil.' })
  @ApiResponse({ status: 401, description: 'Pengguna tidak terautentikasi.' })
  async transcribeAudio(
    @Body('audio') base64Audio: string,
    @Body('format') format: string,
    @Body('model') model?: string,
  ) {
    return this.chatService.transcribeAudio(base64Audio, format, model);
  }
}
