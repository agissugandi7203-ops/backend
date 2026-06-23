import { Injectable, Logger, HttpException, HttpStatus } from '@nestjs/common';
import { SupabaseService } from '../supabase/supabase.service';
import { OpenRouterService } from '../openrouter/openrouter.service';
import { CreateDocumentDto } from './dto/create-document.dto';

@Injectable()
export class KnowledgeBaseService {
  private readonly logger = new Logger(KnowledgeBaseService.name);

  constructor(
    private supabaseService: SupabaseService,
    private openRouterService: OpenRouterService,
  ) {}

  /**
   * Menambahkan dokumen baru ke knowledge base dan menghasilkan vektor embedding
   */
  async createDocument(dto: CreateDocumentDto) {
    this.logger.log(`Generating embedding for document: "${dto.title}"`);
    
    try {
      // 1. Dapatkan embedding dari OpenRouter
      const embedding = await this.openRouterService.getEmbedding(dto.content);
      
      // 2. Simpan ke Supabase
      const supabase = this.supabaseService.getClient();
      const { data, error } = await supabase
        .from('knowledge_base')
        .insert({
          title: dto.title,
          content: dto.content,
          embedding,
          metadata: dto.metadata || {},
        })
        .select('id, title, metadata, created_at')
        .single();

      if (error) {
        throw new HttpException(
          `Database error during document insertion: ${error.message}`,
          HttpStatus.INTERNAL_SERVER_ERROR,
        );
      }

      this.logger.log(`Document "${dto.title}" successfully added with ID: ${data.id}`);
      return {
        message: 'Document successfully added to knowledge base',
        document: data,
      };
    } catch (error) {
      this.logger.error(`Failed to create document: ${error.message}`);
      if (error instanceof HttpException) throw error;
      throw new HttpException(
        `Failed to generate embedding or save document: ${error.message}`,
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  /**
   * Mengambil semua dokumen di knowledge base (Hanya admin - data vektor dikecualikan agar hemat memori)
   */
  async listDocuments() {
    try {
      const supabase = this.supabaseService.getClient();
      const { data, error } = await supabase
        .from('knowledge_base')
        .select('id, title, content, metadata, created_at')
        .order('created_at', { ascending: false });

      if (error) {
        throw new HttpException(
          `Failed to retrieve documents: ${error.message}`,
          HttpStatus.INTERNAL_SERVER_ERROR,
        );
      }

      return data;
    } catch (error) {
      this.logger.error(`Failed to list documents: ${error.message}`);
      if (error instanceof HttpException) throw error;
      throw new HttpException(
        'Internal Server Error',
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  /**
   * Menghapus dokumen di knowledge base
   */
  async deleteDocument(id: string) {
    try {
      const supabase = this.supabaseService.getClient();
      const { error } = await supabase
        .from('knowledge_base')
        .delete()
        .eq('id', id);

      if (error) {
        throw new HttpException(
          `Failed to delete document: ${error.message}`,
          HttpStatus.INTERNAL_SERVER_ERROR,
        );
      }

      this.logger.log(`Document with ID ${id} deleted successfully.`);
      return { message: 'Document successfully deleted' };
    } catch (error) {
      this.logger.error(`Failed to delete document: ${error.message}`);
      if (error instanceof HttpException) throw error;
      throw new HttpException(
        'Internal Server Error',
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }
}
