import { Type } from 'class-transformer';
import {
  IsArray,
  IsBoolean,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
  ValidateIf,
  ValidateNested,
} from 'class-validator';
import {
  AI_IMAGE_EDIT_TIMEOUT_MS_MAX,
  AI_IMAGE_EDIT_TIMEOUT_MS_MIN,
  AI_IMAGE_INPUT_MAX_PX_MAX,
  AI_IMAGE_INPUT_MAX_PX_MIN,
  AI_IMAGE_SIZE_IDS,
} from '../ai-content.constants';

export class PurchaseAiTokensDto {
  @IsInt()
  @Min(1)
  packSize!: number;
}

export class AdminAdjustAiTokensDto {
  @Type(() => Number)
  @IsInt()
  amount!: number;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  note?: string;
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

  /** اگر false باشد فقط تصویر ساخته می‌شود */
  @IsOptional()
  @IsBoolean()
  includeCaption?: boolean;
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

  @IsOptional()
  @IsBoolean()
  includeCaption?: boolean;
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

  @Type(() => Number)
  @IsInt()
  @Min(0)
  sortOrder!: number;
}

export class UpdateAiContentSettingsDto {
  @IsOptional()
  @IsBoolean()
  enabled?: boolean;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  kycWelcomeTokens?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  storyTokenCost?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  tokenPriceToman?: number;

  @IsOptional()
  @IsArray()
  @Type(() => Number)
  @IsInt({ each: true })
  tokenPacks?: number[];

  @IsOptional()
  @IsString()
  @MaxLength(8000)
  storySystemPrompt?: string;

  @IsOptional()
  @IsString()
  @MaxLength(8000)
  storyConstraints?: string;

  /** خالی یا null یعنی حذف مسیر لوگو در تنظیمات متنی */
  @IsOptional()
  @ValidateIf((_, v) => v !== null && v !== undefined)
  @IsString()
  @MaxLength(500)
  storyBrandLogoUrl?: string | null;

  @IsOptional()
  @IsString()
  textModel?: string;

  @IsOptional()
  @IsString()
  imageModel?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(AI_IMAGE_EDIT_TIMEOUT_MS_MIN)
  @Max(AI_IMAGE_EDIT_TIMEOUT_MS_MAX)
  imageEditTimeoutMs?: number;

  @IsOptional()
  @IsString()
  @IsIn(AI_IMAGE_SIZE_IDS)
  imageSize?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(AI_IMAGE_INPUT_MAX_PX_MIN)
  @Max(AI_IMAGE_INPUT_MAX_PX_MAX)
  imageInputMaxPx?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  dailyLimitPerUser?: number;

  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => AiStoryStyleDto)
  styles?: AiStoryStyleDto[];
}
