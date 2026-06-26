import { IsString, IsNotEmpty, IsOptional, IsArray } from 'class-validator';

export class ChatRequestDto {
  @IsString()
  @IsNotEmpty()
  message: string;

  @IsOptional()
  @IsString()
  image?: string; // base64 string

  @IsOptional()
  @IsString()
  pdf?: string; // base64 string

  @IsOptional()
  @IsString()
  audio?: string; // base64 string

  @IsOptional()
  @IsString()
  model?: string; // AI Model selected

  @IsOptional()
  @IsArray()
  history?: { sender: 'user' | 'bot' | 'assistant'; message: string }[];
}
