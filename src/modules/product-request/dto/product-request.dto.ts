import {
  IsEnum,
  IsInt,
  IsNumberString,
  IsOptional,
  IsString,
  MaxLength,
  Min,
  MinLength,
  ValidateIf,
} from 'class-validator';
import { Type } from 'class-transformer';
import { ProductRequestCondition } from '@prisma/client';

export class SubmitProductRequestDto {
  @IsString()
  @MinLength(2)
  @MaxLength(160)
  title!: string;

  @IsOptional()
  @IsString()
  @MaxLength(64)
  categoryId?: string;

  @IsOptional()
  @IsString()
  @MaxLength(80)
  brand?: string;

  @IsOptional()
  @IsString()
  @MaxLength(120)
  model?: string;

  @IsOptional()
  @IsEnum(ProductRequestCondition)
  condition?: ProductRequestCondition;

  @IsOptional()
  @ValidateIf((_, v) => v !== '' && v != null)
  @IsNumberString()
  budgetMin?: string;

  @IsOptional()
  @ValidateIf((_, v) => v !== '' && v != null)
  @IsNumberString()
  budgetMax?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  quantity?: number;

  @IsString()
  @MinLength(10)
  @MaxLength(4000)
  description!: string;
}
