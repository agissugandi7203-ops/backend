import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { KnowledgeBaseService } from './knowledge-base.service';
import { KnowledgeBaseController } from './knowledge-base.controller';

@Module({
  imports: [AuthModule],
  providers: [KnowledgeBaseService],
  controllers: [KnowledgeBaseController],
  exports: [KnowledgeBaseService],
})
export class KnowledgeBaseModule {}
