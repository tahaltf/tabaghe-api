import { IsInt, IsOptional, IsString, MaxLength, Min } from 'class-validator';

export class PurchaseAiTokensDto {
  @IsInt()
  @Min(1)
  packSize!: number;
}

export class GenerateStoryDto {
  @IsString()
  listingId!: string;

  @IsOptional()
  @IsString()
  @MaxLength(1000)
  userPrompt?: string;
}

export class RegenerateStoryDto {
  @IsOptional()
  @IsString()
  @MaxLength(1000)
  userPrompt?: string;
}

export class UpdateAiContentSettingsDto {
  @IsOptional()
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
}
