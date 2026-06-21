import { Type } from 'class-transformer';
import {
  IsArray,
  IsBoolean,
  IsObject,
  IsOptional,
  IsString,
  MaxLength,
  MinLength,
  ValidateNested,
} from 'class-validator';

class LandingSectionPayloadDto {
  @IsString()
  id!: string;

  @IsString()
  type!: string;

  @IsObject()
  props!: Record<string, unknown>;

  @IsOptional()
  @IsObject()
  style?: Record<string, unknown>;
}

export class AdminCreateLandingPageDto {
  @IsString()
  @MinLength(2)
  @MaxLength(120)
  title!: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  description?: string;

  @IsOptional()
  @IsString()
  @MinLength(2)
  @MaxLength(80)
  slug?: string;

  @IsOptional()
  @IsBoolean()
  isPublished?: boolean;

  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => LandingSectionPayloadDto)
  sections?: LandingSectionPayloadDto[];

  @IsOptional()
  @IsObject()
  meta?: Record<string, unknown>;
}

export class AdminUpdateLandingPageDto {
  @IsOptional()
  @IsString()
  @MinLength(2)
  @MaxLength(120)
  title?: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  description?: string;

  @IsOptional()
  @IsString()
  @MinLength(2)
  @MaxLength(80)
  slug?: string;

  @IsOptional()
  @IsBoolean()
  isPublished?: boolean;

  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => LandingSectionPayloadDto)
  sections?: LandingSectionPayloadDto[];

  @IsOptional()
  @IsObject()
  meta?: Record<string, unknown>;
}
