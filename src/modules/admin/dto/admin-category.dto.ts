import { Transform, Type } from 'class-transformer';
import {
  IsBoolean,
  IsNumber,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';

/** Round percentage to 2 decimal places (e.g. 1.8, 3.25). */
function toPercent({ value }: { value: unknown }): number | undefined {
  if (value === null || value === undefined || value === '') return undefined;
  const n = Number(String(value).trim().replace(',', '.'));
  if (!Number.isFinite(n)) return undefined;
  return Math.round(Math.min(100, Math.max(0, n)) * 100) / 100;
}

class BaseCategoryFields {
  @IsOptional()
  @Type(() => Boolean)
  @IsBoolean()
  isActive?: boolean;

  @IsOptional()
  @IsString()
  @MaxLength(120)
  icon?: string | null;

  @IsOptional()
  @IsString()
  parentId?: string | null;

  // Direct sale — condition-specific
  @IsOptional()
  @Transform(toPercent)
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  @Max(100)
  feePercentageDirectNew?: number;

  @IsOptional()
  @Transform(toPercent)
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  @Max(100)
  feePercentageDirectUsed?: number;

  @IsOptional()
  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  feeCapDirect?: number;

  // Auction — condition-specific
  @IsOptional()
  @Transform(toPercent)
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  @Max(100)
  feePercentageAuctionNew?: number;

  @IsOptional()
  @Transform(toPercent)
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  @Max(100)
  feePercentageAuctionUsed?: number;

  @IsOptional()
  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  feeCapAuction?: number;

  // Deposit % — condition-specific
  @IsOptional()
  @Transform(toPercent)
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  @Max(100)
  auctionDepositPercentNew?: number;

  @IsOptional()
  @Transform(toPercent)
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  @Max(100)
  auctionDepositPercentUsed?: number;

  // Legacy single-value fields (kept for compat; synced from New when set)
  @IsOptional()
  @Transform(toPercent)
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  @Max(100)
  feePercentageDirect?: number;

  @IsOptional()
  @Transform(toPercent)
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  @Max(100)
  feePercentageAuction?: number;

  @IsOptional()
  @Transform(toPercent)
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  @Max(100)
  auctionDepositPercent?: number;

  @IsOptional()
  @Transform(toPercent)
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  @Max(100)
  feePercentage?: number;

  @IsOptional()
  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  feeCap?: number;
}

export class CreateCategoryDto extends BaseCategoryFields {
  @IsString()
  @MinLength(2)
  @MaxLength(80)
  title!: string;

  @IsString()
  @MinLength(2)
  @MaxLength(120)
  slug!: string;
}

export class SetCategoryActiveDto {
  @Type(() => Boolean)
  @IsBoolean()
  isActive!: boolean;
}

export class UpdateCategoryDto extends BaseCategoryFields {
  @IsOptional()
  @IsString()
  @MinLength(2)
  @MaxLength(80)
  title?: string;

  @IsOptional()
  @IsString()
  @MinLength(2)
  @MaxLength(120)
  slug?: string;
}
