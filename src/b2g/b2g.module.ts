import { Module } from '@nestjs/common';
import { B2gController } from './b2g.controller';
import { B2gService } from './b2g.service';

@Module({
  controllers: [B2gController],
  providers: [B2gService],
})
export class B2gModule {}
