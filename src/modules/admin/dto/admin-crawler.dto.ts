import {
  IsArray,
  IsBoolean,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  Length,
  Matches,
  Max,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';

const IRANIAN_MOBILE = /^09\d{9}$/;

export class CrawlerPhoneDto {
  @IsString()
  @IsNotEmpty({ message: 'شماره موبایل الزامی است' })
  @Matches(IRANIAN_MOBILE, { message: 'شماره موبایل معتبر نیست' })
  phone!: string;
}

export class CrawlerCodeDto {
  @IsString()
  @IsNotEmpty({ message: 'کد تأیید الزامی است' })
  @Length(6, 6, { message: 'کد تأیید باید ۶ رقم باشد' })
  @Matches(/^\d{6}$/, { message: 'کد تأیید باید ۶ رقم باشد' })
  code!: string;
}

export class CrawlerSettingsDto {
  @IsString()
  @IsNotEmpty({ message: 'شماره موبایل الزامی است' })
  @Matches(IRANIAN_MOBILE, { message: 'شماره موبایل معتبر نیست' })
  login_phone!: string;

  @IsString()
  @IsNotEmpty({ message: 'شهر الزامی است' })
  city!: string;

  @IsString()
  @IsNotEmpty({ message: 'دسته الزامی است' })
  category!: string;

  @IsOptional()
  @IsBoolean()
  marketplace_only?: boolean;

  @IsOptional()
  @IsString()
  custom_list_url?: string;

  @IsOptional()
  @IsString()
  search_query?: string;

  @IsOptional()
  @IsBoolean()
  search_city_wide?: boolean;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(100)
  batch_size?: number;

  @IsOptional()
  @IsArray()
  price_sources?: Array<{ id: string; label?: string; enabled?: boolean }>;
}

export class CrawlerPriceSearchDto {
  @IsString()
  @IsNotEmpty({ message: 'متن جستجو الزامی است' })
  @MaxLength(2000)
  query!: string;

  @IsOptional()
  @IsString()
  city?: string;
}

export class CrawlerPriceSourceItemDto {
  @IsString()
  @IsNotEmpty()
  id!: string;

  @IsOptional()
  @IsString()
  label?: string;

  @IsOptional()
  @IsBoolean()
  enabled?: boolean;
}

export class CrawlerPriceSourcesDto {
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => CrawlerPriceSourceItemDto)
  sources!: CrawlerPriceSourceItemDto[];

  @IsOptional()
  @IsString()
  price_search_city?: string;
}
