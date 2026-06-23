import { IsString, IsNotEmpty, IsOptional, IsObject } from 'class-validator';

export class CreateDocumentDto {
  @IsString()
  @IsNotEmpty()
  title: string;

  @IsString()
  @IsNotEmpty()
  content: string;

  @IsObject()
  @IsOptional()
  metadata?: Record<string, any>;
}
