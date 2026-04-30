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
  @IsIn([
    DisputeOutcome.REFUND_BUYER,
    DisputeOutcome.RELEASE_SELLER,
    DisputeOutcome.PARTIAL_REFUND,
  ])
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

  /** فقط REFUND_BUYER — آدرس مقصدی که خریدار باید کالا را به آن بفرستد (الزامی در سرویس) */
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  returnAddress?: string;

  @IsOptional()
  @IsString()
  @MaxLength(32)
  returnPostalCode?: string;
}
