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
} from 'class-validator';

export class FxIngestRateItemDto {
  @IsString()
  code!: string;

  @Type(() => Number)
  @IsNumber()
  @Min(0.0001)
  rateToToman!: number;
}

export class FxIngestRatesDto {
  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => FxIngestRateItemDto)
  rates!: FxIngestRateItemDto[];

  /** اگر rial باشد مقادیر ÷۱۰ به تومان تبدیل می‌شوند */
  @IsOptional()
  @IsIn(['toman', 'rial'])
  unit?: 'toman' | 'rial';

  @IsOptional()
  @IsString()
  source?: string;
}
