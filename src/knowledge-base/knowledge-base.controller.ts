import {
  Controller,
  Get,
  Post,
  Delete,
  Body,
  Param,
  UseGuards,
  HttpStatus,
  HttpCode,
} from '@nestjs/common';
import { AuthGuard } from '../auth/auth.guard';
import { RolesGuard } from '../auth/roles.guard';
import { Roles } from '../auth/roles.decorator';
import { KnowledgeBaseService } from './knowledge-base.service';
import { CreateDocumentDto } from './dto/create-document.dto';
import { ApiTags, ApiOperation, ApiResponse, ApiBearerAuth, ApiParam } from '@nestjs/swagger';

@ApiTags('Dokumen Basis Pengetahuan RAG (Knowledge Base)')
@ApiBearerAuth('JWT-auth')
@Controller('knowledge-base')
@UseGuards(AuthGuard)
export class KnowledgeBaseController {
  constructor(private readonly knowledgeBaseService: KnowledgeBaseService) {}

  /**
   * Mengambil semua dokumen regulasi (Hanya untuk Admin)
   */
  @Get()
  @UseGuards(RolesGuard)
  @Roles('admin')
  @ApiOperation({
    summary: 'Daftar Semua Dokumen Regulasi RAG (Admin Only)',
    description: 'Menampilkan seluruh dokumen regulasi, kebijakan sampah, dan dokumen hukum yang masuk ke basis pengetahuan RAG untuk Chatbot AI. Hanya dapat diakses oleh Administrator.',
  })
  @ApiResponse({ status: 200, description: 'Daftar dokumen berhasil diambil.' })
  @ApiResponse({ status: 403, description: 'Akses ditolak (Bukan Administrator).' })
  async listDocuments() {
    return this.knowledgeBaseService.listDocuments();
  }

  /**
   * Menambahkan dokumen regulasi baru (Hanya untuk Admin)
   */
  @Post()
  @UseGuards(RolesGuard)
  @Roles('admin')
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({
    summary: 'Unggah Dokumen RAG Baru (Admin Only)',
    description: 'Menambahkan naskah dokumen regulasi atau panduan sampah baru ke database vector RAG untuk menambah wawasan pengetahuan Chatbot AI. Hanya dapat dijalankan oleh Administrator.',
  })
  @ApiResponse({ status: 201, description: 'Dokumen berhasil diunggah dan terindeks.' })
  @ApiResponse({ status: 403, description: 'Akses ditolak.' })
  async createDocument(@Body() dto: CreateDocumentDto) {
    return this.knowledgeBaseService.createDocument(dto);
  }

  /**
   * Menghapus dokumen regulasi berdasarkan ID (Hanya untuk Admin)
   */
  @Delete(':id')
  @UseGuards(RolesGuard)
  @Roles('admin')
  @ApiOperation({
    summary: 'Hapus Dokumen RAG (Admin Only)',
    description: 'Menghapus salah satu dokumen regulasi dari index pengetahuan RAG Chatbot berdasarkan ID dokumen. Hanya dapat dijalankan oleh Administrator.',
  })
  @ApiParam({ name: 'id', description: 'ID dokumen regulasi yang ingin dihapus' })
  @ApiResponse({ status: 200, description: 'Dokumen berhasil dihapus dari basis pengetahuan.' })
  @ApiResponse({ status: 403, description: 'Akses ditolak.' })
  async deleteDocument(@Param('id') id: string) {
    return this.knowledgeBaseService.deleteDocument(id);
  }
}
