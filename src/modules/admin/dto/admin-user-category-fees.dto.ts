import { Transform, Type } from 'class-transformer';
import {
  IsArray,
  IsNumber,
  IsOptional,
  IsString,
  Max,
  Min,
  ValidateNested,
} from 'class-validator';

/** Keep null (category default); otherwise number rounded to 2 decimal places. */
function toPercentOrNull({ value }: { value: unknown }): number | null {
  if (value === null || value === undefined || value === '') return null;
  const n = Number(String(value).trim().replace(',', '.'));
  if (!Number.isFinite(n)) return null;
  return Math.round(Math.min(100, Math.max(0, n)) * 100) / 100;
}

export class UserCategoryFeeItemDto {
  @IsString()
  categoryId!: string;

  @IsOptional()
  @Transform(toPercentOrNull)
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  @Max(100)
  feePercentageDirectNew?: number | null;

  @IsOptional()
  @Transform(toPercentOrNull)
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  @Max(100)
  feePercentageDirectUsed?: number | null;

  @IsOptional()
  @Transform(toPercentOrNull)
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  @Max(100)
  feePercentageAuctionNew?: number | null;

  @IsOptional()
  @Transform(toPercentOrNull)
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  @Max(100)
  feePercentageAuctionUsed?: number | null;

  @IsOptional()
  @Transform(toPercentOrNull)
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  @Max(100)
  auctionDepositPercentNew?: number | null;

  @IsOptional()
  @Transform(toPercentOrNull)
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  @Max(100)
  auctionDepositPercentUsed?: number | null;
}

export class UpsertUserCategoryFeesDto {
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => UserCategoryFeeItemDto)
  items!: UserCategoryFeeItemDto[];
}
