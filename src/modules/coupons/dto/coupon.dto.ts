import { Type } from 'class-transformer';
import {
  IsArray,
  IsBoolean,
  IsDateString,
  IsEnum,
  IsInt,
  IsOptional,
  IsString,
  Min,
} from 'class-validator';
import { PartialType } from '@nestjs/mapped-types';
import { CouponDiscountType, CouponScopeMode } from '@prisma/client';

export class ValidateCouponDto {
  @IsString()
  code!: string;

  @IsOptional()
  @IsArray()
  items?: Array<{
    listingId: string;
    quantity: number;
    unitPrice: number;
    categoryId: string;
    onSale?: boolean;
  }>;

  @IsOptional()
  @IsString()
  listingId?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  quantity?: number;
}

export class CreateCouponDto {
  @IsString()
  code!: string;

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;

  @IsOptional()
  @IsDateString()
  startsAt?: string | null;

  @IsOptional()
  @IsDateString()
  expiresAt?: string | null;

  @IsEnum(CouponDiscountType)
  discountType!: CouponDiscountType;

  @Type(() => Number)
  @IsInt()
  @Min(0)
  discountValue!: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  maxDiscountAmount?: number | null;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  minOrderAmount?: number | null;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  maxUsesTotal?: number | null;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  maxUsesPerUser?: number | null;

  @IsOptional()
  @IsBoolean()
  allowOnSaleItems?: boolean;

  @IsOptional()
  @IsEnum(CouponScopeMode)
  scopeMode?: CouponScopeMode;

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  categoryIds?: string[];

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  listingIds?: string[];

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  userIds?: string[];
}

export class UpdateCouponDto extends PartialType(CreateCouponDto) {}

export class ValidateSingleOrderCouponDto {
  @IsString()
  code!: string;

  @IsString()
  listingId!: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  quantity?: number;
}
