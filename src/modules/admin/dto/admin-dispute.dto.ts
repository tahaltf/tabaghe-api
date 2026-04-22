import { Type } from 'class-transformer';
import {
  IsEnum,
  IsIn,
  IsNumber,
  IsOptional,
  IsString,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';
import { DisputeOutcome } from '@prisma/client';
import { AdminListQueryDto } from './admin-query.dto';

export class AdminDisputeListQueryDto extends AdminListQueryDto {
  @IsOptional()
  @IsIn(['OPEN', 'RESOLVED', 'ALL'])
  resolution?: 'OPEN' | 'RESOLVED' | 'ALL';
}

export class ResolveDisputeDto {
  @IsEnum(DisputeOutcome)
  outcome!: DisputeOutcome;

  @IsString()
  @MinLength(3)
  @MaxLength(2000)
  resolution!: string;

  /** مبلغ بازگشت به خریدار (ریال) - فقط برای PARTIAL_REFUND */
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  refundToBuyer?: number;
}
