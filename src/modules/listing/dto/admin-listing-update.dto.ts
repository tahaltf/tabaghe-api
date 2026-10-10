import { ItemCondition, ShippingPayer } from '@prisma/client';
import { Transform, Type } from 'class-transformer';
import {
  IsArray,
  IsBoolean,
  IsEnum,
  IsInt,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
  MinLength,
  ValidateIf,
  ValidateNested,
} from 'class-validator';
import {
  ListingVariationInputDto,
  VariationAxisDto,
  transformVariationAxes,
  transformVariations,
} from './create-listing.dto';

const toBoolean = ({ value }: { value: unknown }): boolean | undefined => {
  if (value === undefined || value === null || value === '') return undefined;
  if (value === true || value === 'true' || value === 1 || value === '1') return true;
  if (value === false || value === 'false' || value === 0 || value === '0') return false;
  return Boolean(value);
};

/** ویرایش آگهی توسط ادمین (حتی پس از تایید) */
export class AdminListingUpdateDto {
  @IsOptional()
  @IsString()
  @MinLength(2)
  @MaxLength(200)
  title?: string;

  @IsOptional()
  @IsString()
  @MaxLength(8000)
  description?: string;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  desiredTitle?: string;

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  desiredDescription?: string;

  @IsOptional()
  @IsEnum(ShippingPayer)
  shippingPayer?: ShippingPayer;

  /** null = بازگشت به هزینه پیش‌فرض سایت */
  @IsOptional()
  @ValidateIf((_, v) => v !== null)
  @Type(() => Number)
  @IsInt()
  @Min(0)
  shippingCostOverride?: number | null;

  @IsOptional()
  @IsEnum(ItemCondition)
  condition?: ItemCondition;

  @IsOptional()
  @ValidateIf((o) => o.testPeriodDays != null)
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(365)
  testPeriodDays?: number | null;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  stockQuantity?: number;

  /** قیمت فروش مستقیم */
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  price?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  compareAtPrice?: number | null;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  salePrice?: number | null;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  basePrice?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(5000)
  minBidIncrement?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  buyNowPrice?: number;

  /** تبدیل / نگه‌داشتن محصول متغیر (ادمین؛ بدون محدودیت منبع import) */
  @IsOptional()
  @Transform(toBoolean)
  @IsBoolean()
  isVariable?: boolean;

  @IsOptional()
  @Transform(transformVariationAxes)
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => VariationAxisDto)
  variationAttributes?: VariationAxisDto[];

  @IsOptional()
  @Transform(transformVariations)
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => ListingVariationInputDto)
  variations?: ListingVariationInputDto[];
}
