import { Module } from '@nestjs/common';
import { ReportsController } from './reports.controller';
import { ReportsService } from './reports.service';
import { AiClassificationService } from './ai-classification.service';
import { ProfilesModule } from '../profiles/profiles.module';

@Module({
  imports: [ProfilesModule],
  controllers: [ReportsController],
  providers: [ReportsService, AiClassificationService],
  exports: [ReportsService, AiClassificationService],
})
export class ReportsModule {}
