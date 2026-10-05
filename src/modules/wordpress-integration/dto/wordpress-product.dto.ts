import { Transform, Type } from 'class-transformer';
import {
  IsArray,
  IsBoolean,
  IsInt,
  IsNumber,
  IsObject,
  IsOptional,
  IsString,
  IsUrl,
  MaxLength,
  Min,
  ValidateIf,
  ValidateNested,
} from 'class-validator';

export class WordPressProductImageDto {
  @IsUrl({ require_protocol: true })
  @MaxLength(2000)
  url!: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  alt?: string;

  @IsOptional()
  @IsNumber()
  position?: number;
}

export class WordPressProductAttributeDto {
  @IsString()
  @MaxLength(200)
  name!: string;

  @IsString()
  @MaxLength(200)
  slug!: string;

  @IsBoolean()
  visible!: boolean;

  @IsBoolean()
  variation!: boolean;

  @IsArray()
  @IsString({ each: true })
  options!: string[];
}

export class WordPressProductCategoryDto {
  @IsString()
  @MaxLength(200)
  name!: string;

  @IsString()
  @MaxLength(200)
  slug!: string;
}

export class WordPressVariationAttributeDto {
  @IsString()
  @MaxLength(200)
  name!: string;

  @IsString()
  @MaxLength(200)
  value!: string;
}

export class WordPressVariationAxisDto {
  @IsString()
  @MaxLength(200)
  name!: string;

  @IsArray()
  @IsString({ each: true })
  options!: string[];
}

export class WordPressVariationDto {
  @IsOptional()
  @IsString()
  @MaxLength(64)
  externalVariationId?: string;

  @IsOptional()
  @IsString()
  @MaxLength(128)
  sku?: string | null;

  @IsNumber()
  @Min(0)
  price!: number;

  @IsOptional()
  @IsNumber()
  @Min(0)
  regularPrice?: number;

  @IsOptional()
  @IsNumber()
  @Min(0)
  salePrice?: number | null;

  @IsOptional()
  @Transform(({ value }) => {
    if (value === null || value === undefined || value === '') return null;
    const n = Number(value);
    if (!Number.isFinite(n)) return null;
    const qty = Math.floor(n);
    if (qty < 0) return null;
    return qty;
  })
  @ValidateIf((_, value) => value != null)
  @IsInt()
  @Min(0)
  stockQuantity?: number | null;

  @IsOptional()
  @IsBoolean()
  inStock?: boolean;

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  imageUrl?: string | null;

  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => WordPressVariationAttributeDto)
  attributes!: WordPressVariationAttributeDto[];
}

export class WordPressProductDto {
  @IsString()
  @MaxLength(64)
  externalProductId!: string;

  @IsUrl({ require_protocol: true })
  @MaxLength(500)
  siteUrl!: string;

  @IsString()
  @MaxLength(300)
  title!: string;

  @IsOptional()
  @IsString()
  @MaxLength(64)
  categoryId?: string;

  @IsOptional()
  @IsString()
  @MaxLength(50000)
  shortDescription?: string;

  @IsString()
  @MaxLength(200000)
  description!: string;

  @IsNumber()
  @Min(0)
  price!: number;

  @IsOptional()
  @IsNumber()
  @Min(0)
  regularPrice?: number;

  @IsOptional()
  @IsNumber()
  @Min(0)
  salePrice?: number;

  /** Listing currency code (IRT/USD/AED/IQD/TRY). Defaults to IRT when omitted. */
  @IsOptional()
  @IsString()
  @MaxLength(8)
  @Transform(({ value }) => {
    if (value == null || value === '') return undefined;
    return String(value).trim().toUpperCase();
  })
  priceCurrencyCode?: string;

  @IsOptional()
  @IsString()
  @MaxLength(128)
  sku?: string;

  @IsOptional()
  @IsString()
  @MaxLength(32)
  status?: string;

  @IsOptional()
  @IsBoolean()
  inStock?: boolean;

  @IsOptional()
  @IsString()
  @MaxLength(32)
  stockStatus?: string;

  @IsOptional()
  @Transform(({ value }) => {
    if (value === null || value === undefined || value === '') return null;
    const n = Number(value);
    if (!Number.isFinite(n)) return null;
    const qty = Math.floor(n);
    if (qty < 0) return null;
    return qty;
  })
  @ValidateIf((_, value) => value != null)
  @IsInt()
  @Min(0)
  stockQuantity?: number | null;

  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => WordPressProductImageDto)
  images!: WordPressProductImageDto[];

  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => WordPressProductAttributeDto)
  attributes!: WordPressProductAttributeDto[];

  @IsOptional()
  @IsBoolean()
  isVariable?: boolean;

  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => WordPressVariationAxisDto)
  variationAttributes?: WordPressVariationAxisDto[];

  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => WordPressVariationDto)
  variations?: WordPressVariationDto[];

  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => WordPressProductCategoryDto)
  categories?: WordPressProductCategoryDto[];

  @IsOptional()
  @IsObject()
  meta?: Record<string, string>;
}

export class WordPressProductBulkDto {
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => WordPressProductDto)
  products!: WordPressProductDto[];
}
