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

export class MarketIngestItemDto {
  @IsString()
  code!: string;

  @IsString()
  nameFa!: string;

  @IsString()
  category!: string;

  @Type(() => Number)
  @IsNumber()
  @Min(0)
  value!: number;

  @IsOptional()
  @IsIn(['toman', 'rial', 'usd', 'ratio', 'other'])
  unit?: 'toman' | 'rial' | 'usd' | 'ratio' | 'other';

  @IsOptional()
  @IsString()
  source?: string;

  @IsOptional()
  @IsString()
  change?: string;
}

export class MarketIngestDto {
  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => MarketIngestItemDto)
  items!: MarketIngestItemDto[];

  @IsOptional()
  @IsString()
  source?: string;
}
