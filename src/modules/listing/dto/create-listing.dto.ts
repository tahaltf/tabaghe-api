import { plainToInstance, Transform, Type } from 'class-transformer';
import {
  IsArray,
  IsBoolean,
  IsDateString,
  IsEnum,
  IsInt,
  IsOptional,
  IsString,
  Max,
  Min,
  ValidateIf,
  ValidateNested,
} from 'class-validator';
import {
  ExchangePayer,
  ItemCondition,
  ListingType,
  ShippingPayer,
} from '@prisma/client';

/**
 * multipart / query: فقط true صریح؛ بقیه false.
 * نکته: با `enableImplicitConversion` اول `Boolean("false") === true` اعمال می‌شود و بعد
 * به این تابع می‌رسد؛ پس باید مقدار خام را از `obj[key]` بخوانیم نه از `value`.
 */
const toBoolean = ({
  value,
  key,
  obj,
}: {
  value: unknown;
  key: string;
  obj: unknown;
}): boolean => {
  let raw: unknown = value;
  if (
    obj &&
    typeof obj === 'object' &&
    !Array.isArray(obj) &&
    !(obj instanceof Date)
  ) {
    const o = obj as Record<string, unknown>;
    if (Object.prototype.hasOwnProperty.call(o, key)) {
      raw = o[key];
    }
  }
  if (raw === true || raw === 'true' || raw === 1 || raw === '1') return true;
  return false;
};

/**
 * وقتی از multipart/form-data استفاده می‌کنیم، بخش‌های nested به‌صورت JSON string
 * می‌آیند و این transformer آن‌ها را به object تبدیل می‌کند تا ValidateNested کار کند.
 */
class DirectPayloadDto {
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  price?: number;

  @IsOptional()
  @Transform(toBoolean)
  @IsBoolean()
  allowExchange?: boolean;

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  shippingMethods?: string[];
}

class ExchangePayloadDto {
  @IsOptional()
  @IsString()
  desiredCategoryId?: string;

  @IsOptional()
  @IsString()
  desiredTitle?: string;

  @IsOptional()
  @IsString()
  desiredDescription?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  ownValue?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  extraPaymentAmount?: number;

  @IsOptional()
  @Transform(toBoolean)
  @IsBoolean()
  acceptOtherItems?: boolean;

  @IsOptional()
  @Transform(toBoolean)
  @IsBoolean()
  allowDirectSale?: boolean;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  directPrice?: number;
}

class AuctionPayloadDto {
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
  @IsDateString()
  endDatetime?: string;

  @IsOptional()
  @Transform(toBoolean)
  @IsBoolean()
  buyNowEnabled?: boolean;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  buyNowPrice?: number;
}

/** تبدیل به نمونهٔ کلاس برای ValidateNested + forbidNonWhitelisted در multipart */
function toNested<T extends object>(
  Cls: new () => T,
  value: unknown,
): T | unknown {
  let raw = value;
  if (typeof raw === 'string') {
    try {
      raw = JSON.parse(raw);
    } catch {
      return value;
    }
  }
  if (raw && typeof raw === 'object' && !Array.isArray(raw)) {
    return plainToInstance(Cls, raw as object, {
      enableImplicitConversion: true,
    });
  }
  return raw;
}

const transformDirect = ({ value }: { value: unknown }) =>
  toNested(DirectPayloadDto, value);
const transformExchange = ({ value }: { value: unknown }) =>
  toNested(ExchangePayloadDto, value);
const transformAuction = ({ value }: { value: unknown }) =>
  toNested(AuctionPayloadDto, value);

export class CreateListingDto {
  @IsEnum(ListingType)
  type!: ListingType;

  @IsString()
  title!: string;

  @IsString()
  categoryId!: string;

  @IsEnum(ItemCondition)
  condition!: ItemCondition;

  @IsOptional()
  @IsString()
  description?: string;

  @IsString()
  provinceId!: string;

  @IsString()
  cityId!: string;

  @IsOptional()
  @IsEnum(ShippingPayer)
  shippingPayer?: ShippingPayer;

  @IsOptional()
  @IsEnum(ExchangePayer)
  exchangePayer?: ExchangePayer;

  @IsOptional()
  @Transform(toBoolean)
  @IsBoolean()
  sellerRequiresVerification?: boolean;

  /** تعداد روز مهلت تست/گارانتی؛ خالی یا ۰ = بدون گارانتی */
  @IsOptional()
  @Transform(({ value }) => {
    if (value === null || value === undefined || value === '') return null;
    const n = Number(value);
    if (!Number.isFinite(n) || n <= 0) return null;
    return Math.min(365, Math.floor(n));
  })
  @ValidateIf((o) => o.testPeriodDays != null)
  @IsInt()
  @Min(1)
  @Max(365)
  testPeriodDays?: number | null;

  @IsOptional()
  @IsString()
  thumbnail?: string;

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  gallery?: string[];

  @IsOptional()
  @Transform(transformDirect)
  @ValidateNested()
  @Type(() => DirectPayloadDto)
  direct?: DirectPayloadDto;

  @IsOptional()
  @Transform(transformExchange)
  @ValidateNested()
  @Type(() => ExchangePayloadDto)
  exchange?: ExchangePayloadDto;

  @IsOptional()
  @Transform(transformAuction)
  @ValidateNested()
  @Type(() => AuctionPayloadDto)
  auction?: AuctionPayloadDto;
}

export { DirectPayloadDto, ExchangePayloadDto, AuctionPayloadDto };
