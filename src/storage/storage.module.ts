import { Module, Global } from '@nestjs/common';
import { GcsService } from './gcs.service';
import { PiiRedactionService } from './pii-redaction.service';

@Global()
@Module({
  providers: [GcsService, PiiRedactionService],
  exports: [GcsService, PiiRedactionService],
})
export class StorageModule {}
