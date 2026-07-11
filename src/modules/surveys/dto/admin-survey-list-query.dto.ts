import { IsIn, IsInt, IsOptional, IsString, Max, Min } from 'class-validator';
import { Type } from 'class-transformer';
import { SurveyRole } from '@prisma/client';

export class AdminSurveyListQueryDto {
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  pageSize?: number;

  @IsOptional()
  @IsIn(['BUYER', 'SELLER'])
  role?: SurveyRole;

  @IsOptional()
  @IsIn(['pending', 'sent', 'responded', 'expired'])
  status?: 'pending' | 'sent' | 'responded' | 'expired';

  @IsOptional()
  @IsString()
  orderId?: string;

  @IsOptional()
  @IsString()
  q?: string;
}
