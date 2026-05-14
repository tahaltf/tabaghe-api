import { Type } from 'class-transformer';
import {
  IsNumber,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';

class BaseCategoryFields {
  @IsOptional()
  @IsString()
  @MaxLength(120)
  icon?: string | null;

  @IsOptional()
  @IsString()
  parentId?: string | null;

  // Direct sale
  @IsOptional()
  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  @Max(100)
  feePercentageDirect?: number;

  @IsOptional()
  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  feeCapDirect?: number;

  // Auction
  @IsOptional()
  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  @Max(100)
  feePercentageAuction?: number;

  @IsOptional()
  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  feeCapAuction?: number;

  // Deposit %
  @IsOptional()
  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  @Max(100)
  auctionDepositPercent?: number;

  // Legacy
  @IsOptional()
  @Type(() => Number)
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
