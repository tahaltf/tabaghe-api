import { Type } from 'class-transformer';
import {
  IsBoolean,
  IsDateString,
  IsNumber,
  IsOptional,
  Min,
} from 'class-validator';

export class AdminSetCurrencyEnabledDto {
  @IsBoolean()
  isEnabled!: boolean;
}

export class AdminSetCurrencyRateOverrideDto {
  @Type(() => Number)
  @IsNumber()
  @Min(0.0001)
  rateToToman!: number;

  @IsOptional()
  @IsDateString()
  overrideUntil?: string | null;
}
