import { IsOptional, IsInt, Min } from 'class-validator';

export class AdjustGamificationDto {
  @IsOptional()
  @IsInt()
  @Min(0)
  xp?: number;

  @IsOptional()
  @IsInt()
  @Min(1)
  level?: number;

  @IsOptional()
  @IsInt()
  @Min(0)
  current_streak?: number;
}
