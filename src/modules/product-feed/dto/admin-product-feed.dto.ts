import { Transform, Type } from 'class-transformer';
import {
  IsBoolean,
  IsIn,
  IsNumber,
  IsOptional,
  IsString,
  IsUrl,
  Max,
  MaxLength,
  Min,
  ValidateIf,
} from 'class-validator';

export const PRODUCT_FEED_CURRENCY_CODES = ['IRT', 'USD', 'AED', 'IQD'] as const;
export const PRODUCT_FEED_MARKUP_TYPES = ['NONE', 'PERCENT', 'FIXED'] as const;

export type ProductFeedCurrencyCode =
  (typeof PRODUCT_FEED_CURRENCY_CODES)[number];
export type ProductFeedMarkupType = (typeof PRODUCT_FEED_MARKUP_TYPES)[number];

function toOptionalBoolean(value: unknown): boolean | undefined {
  if (value === undefined || value === null || value === '') return undefined;
  if (value === true || value === 'true' || value === 1 || value === '1') {
    return true;
  }
  if (value === false || value === 'false' || value === 0 || value === '0') {
    return false;
  }
  return undefined;
}

function emptyToNull(value: unknown): string | null | undefined {
  if (value === undefined) return undefined;
  if (value === null) return null;
  const s = String(value).trim();
  return s === '' ? null : s;
}

export class AdminUpsertProductFeedDto {
  @IsOptional()
  @Transform(({ value }) => toOptionalBoolean(value))
  @IsBoolean()
  enabled?: boolean;

  @IsOptional()
  @Transform(({ value }) => emptyToNull(value))
  @ValidateIf((_, v) => v != null && v !== '')
  @IsUrl(
    { protocols: ['https'], require_protocol: true },
    { message: 'آدرس فید باید یک URL امن (https) معتبر باشد' },
  )
  feedUrl?: string | null;

  @IsOptional()
  @IsString()
  @IsIn([...PRODUCT_FEED_CURRENCY_CODES], {
    message: 'ارز باید یکی از IRT، USD، AED یا IQD باشد',
  })
  currencyCode?: ProductFeedCurrencyCode;

  @IsOptional()
  @IsString()
  @IsIn([...PRODUCT_FEED_MARKUP_TYPES], {
    message: 'نوع مارکاپ باید NONE، PERCENT یا FIXED باشد',
  })
  markupType?: ProductFeedMarkupType;

  @IsOptional()
  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 4 })
  @Min(0)
  @Max(1_000_000_000)
  markupValue?: number;

  @IsOptional()
  @Transform(({ value }) => emptyToNull(value))
  @ValidateIf((_, v) => v != null)
  @IsString()
  @MaxLength(2000)
  descriptionSuffix?: string | null;

  @IsOptional()
  @Transform(({ value }) => emptyToNull(value))
  @ValidateIf((_, v) => v != null)
  @IsString()
  @MaxLength(64)
  defaultCategoryId?: string | null;
}
