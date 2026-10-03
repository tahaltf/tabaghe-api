import { Type } from 'class-transformer';
import {
  ArrayMinSize,
  IsArray,
  IsIn,
  IsNumber,
  IsOptional,
  IsString,
  Min,
  ValidateNested,
  ValidateIf,
} from 'class-validator';
import { MarketIngestItemDto } from './market-ingest.dto';

export class FxIngestQuoteDto {
  @IsString()
  source!: string;

  @Type(() => Number)
  @IsNumber()
  @Min(0.0001)
  rateToToman!: number;
}

export class FxIngestRateItemDto {
  @IsString()
  code!: string;

  /** تک‌نرخی (سازگاری عقب‌رو) — اگر quotes باشد اختیاری است */
  @ValidateIf((o: FxIngestRateItemDto) => !o.quotes?.length)
  @Type(() => Number)
  @IsNumber()
  @Min(0.0001)
  rateToToman?: number;

  /** نقل‌قول چندمنبعی — سرور min/max/mid را حساب می‌کند */
  @IsOptional()
  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => FxIngestQuoteDto)
  quotes?: FxIngestQuoteDto[];
}

export class FxIngestRatesDto {
  /** ارزهای لیستینگ؛ اگر فقط market بفرستید می‌تواند خالی باشد */
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => FxIngestRateItemDto)
  rates?: FxIngestRateItemDto[];

  /** تابلو بازار (طلا، سکه، تتر، نفت، ...) */
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => MarketIngestItemDto)
  market?: MarketIngestItemDto[];

  /** اگر rial باشد مقادیر ÷۱۰ به تومان تبدیل می‌شوند */
  @IsOptional()
  @IsIn(['toman', 'rial'])
  unit?: 'toman' | 'rial';

  @IsOptional()
  @IsString()
  source?: string;
}
