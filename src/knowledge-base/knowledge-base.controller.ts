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
  async createDocument(@Body() dto: CreateDocumentDto) {
    return this.knowledgeBaseService.createDocument(dto);
  }

  /**
   * Menghapus dokumen regulasi berdasarkan ID (Hanya untuk Admin)
   */
  @Delete(':id')
  @UseGuards(RolesGuard)
  @Roles('admin')
  async deleteDocument(@Param('id') id: string) {
    return this.knowledgeBaseService.deleteDocument(id);
  }
}
