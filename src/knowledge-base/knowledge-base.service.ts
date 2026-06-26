import { Injectable, Logger, HttpException, HttpStatus } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { SupabaseService } from '../supabase/supabase.service';
import { OpenRouterService } from '../openrouter/openrouter.service';
import { CreateDocumentDto } from './dto/create-document.dto';

@Injectable()
export class KnowledgeBaseService {
  private readonly logger = new Logger(KnowledgeBaseService.name);

  constructor(
    private supabaseService: SupabaseService,
    private openRouterService: OpenRouterService,
    private configService: ConfigService,
  ) {}
  private chunkText(
    text: string,
    chunkSize: number = 800,
    chunkOverlap: number = 150,
  ): string[] {
    const chunks: string[] = [];
    let start = 0;

    while (start < text.length) {
      let end = start + chunkSize;
      if (end >= text.length) {
        end = text.length;
        chunks.push(text.substring(start, end).trim());
        break;
      }

      // Cari spasi terdekat agar pemotongan rapi (tidak memotong kata)
      const nextSpace = text.indexOf(' ', end);
      if (nextSpace !== -1 && nextSpace - end < 50) {
        end = nextSpace;
      }

      chunks.push(text.substring(start, end).trim());
      start = end - chunkOverlap;
      if (start <= 0 || start >= text.length) break;
    }

    return chunks.filter((c) => c.length > 0);
  }

  /**
   * Menambahkan dokumen baru ke knowledge base dengan pemotongan chunk dan embedding vektor
   */
  async createDocument(dto: CreateDocumentDto) {
    this.logger.log(`Processing document: "${dto.title}"`);

    try {
      const chunkSize =
        Number(this.configService.get<number>('RAG_CHUNK_SIZE')) || 800;
      const chunkOverlap =
        Number(this.configService.get<number>('RAG_CHUNK_OVERLAP')) || 150;
      const chunks = this.chunkText(dto.content, chunkSize, chunkOverlap);
      this.logger.log(
        `Document "${dto.title}" split into ${chunks.length} chunks`,
      );

      const savedChunks: any[] = [];
      const supabase = this.supabaseService.getClient();

      for (let i = 0; i < chunks.length; i++) {
        const chunkContent = chunks[i];
        const chunkTitle =
          chunks.length > 1 ? `${dto.title} - Bagian ${i + 1}` : dto.title;

        this.logger.log(
          `Generating embedding for chunk ${i + 1}/${chunks.length}`,
        );
        const embedding =
          await this.openRouterService.getEmbedding(chunkContent);

        const { data, error } = await supabase
          .from('knowledge_base')
          .insert({
            title: chunkTitle,
            content: chunkContent,
            embedding,
            metadata: {
              ...(dto.metadata || {}),
              original_title: dto.title,
              chunk_index: i,
              total_chunks: chunks.length,
            },
          })
          .select('id, title, metadata, created_at')
          .single();

        if (error) {
          throw new HttpException(
            `Database error during document insertion at chunk ${i + 1}: ${error.message}`,
            HttpStatus.INTERNAL_SERVER_ERROR,
          );
        }
        savedChunks.push(data);
      }

      this.logger.log(
        `Document "${dto.title}" successfully ingested. Total chunks: ${chunks.length}`,
      );
      return {
        message: `Document successfully split into ${chunks.length} chunks and added to knowledge base`,
        documents: savedChunks,
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
