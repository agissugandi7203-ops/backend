import {
  IsOptional,
  IsString,
  IsIn,
  IsNumber,
  Min,
  Max,
} from 'class-validator';

export class UpdateReportDto {
  @IsOptional()
  @IsString()
  @IsIn(['pending_ai', 'approved', 'rejected', 'pending_human'])
  status?: string;

  @IsOptional()
  @IsString()
  waste_type?: string;

  @IsOptional()
  @IsString()
  @IsIn(['low', 'medium', 'high'])
  danger_level?: string;

  @IsOptional()
  @IsNumber()
  @Min(0.0)
  @Max(1.0)
  confidence_score?: number;

  @IsOptional()
  @IsString()
  admin_notes?: string;
}
