import { Type } from 'class-transformer';
import {
  IsArray,
  IsBoolean,
  IsInt,
  IsOptional,
  IsString,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';

export class PurchaseAiTokensDto {
  @IsInt()
  @Min(1)
  packSize!: number;
}

export class GenerateStoryDto {
  @IsString()
  listingId!: string;

  @IsString()
  @MaxLength(64)
  styleId!: string;

  @IsOptional()
  @IsString()
  @MaxLength(1000)
  userPrompt?: string;
}

export class RegenerateStoryDto {
  @IsOptional()
  @IsString()
  @MaxLength(64)
  styleId?: string;

  @IsOptional()
  @IsString()
  @MaxLength(1000)
  userPrompt?: string;
}

export class AiStoryStyleDto {
  @IsString()
  @MaxLength(64)
  id!: string;

  @IsString()
  @MaxLength(80)
  label!: string;

  @IsString()
  @MaxLength(4000)
  promptAddon!: string;

  @IsBoolean()
  enabled!: boolean;

  @IsInt()
  @Min(0)
  sortOrder!: number;
}

export class UpdateAiContentSettingsDto {
  @IsOptional()
  @IsBoolean()
  enabled?: boolean;

  @IsOptional()
  @IsInt()
  @Min(0)
  kycWelcomeTokens?: number;

  @IsOptional()
  @IsInt()
  @Min(1)
  storyTokenCost?: number;

  @IsOptional()
  @IsInt()
  @Min(0)
  tokenPriceToman?: number;

  @IsOptional()
  tokenPacks?: number[];

  @IsOptional()
  @IsString()
  @MaxLength(8000)
  storySystemPrompt?: string;

  @IsOptional()
  @IsString()
  @MaxLength(8000)
  storyConstraints?: string;

  @IsOptional()
  @IsString()
  storyBrandLogoUrl?: string;

  @IsOptional()
  @IsString()
  textModel?: string;

  @IsOptional()
  @IsString()
  imageModel?: string;

  @IsOptional()
  @IsInt()
  @Min(1)
  dailyLimitPerUser?: number;

  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => AiStoryStyleDto)
  styles?: AiStoryStyleDto[];
}
