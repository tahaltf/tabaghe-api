import {
  IsArray,
  IsBoolean,
  IsEnum,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  MinLength,
} from 'class-validator';
import { MarketingMediaType, MarketingPostStatus } from '@prisma/client';

export class CreateMarketingPostDto {
  @IsString()
  accountId!: string;

  @IsEnum(MarketingMediaType)
  mediaType!: MarketingMediaType;

  @IsOptional()
  @IsString()
  @MaxLength(2200)
  caption?: string;

  @IsOptional()
  @IsString()
  mediaAssetId?: string;

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  mediaAssetIds?: string[];

  @IsOptional()
  @IsString()
  scheduledAt?: string;

  @IsOptional()
  @IsBoolean()
  publishNow?: boolean;
}

export class UpdateMarketingCaptionDto {
  @IsString()
  @MaxLength(2200)
  caption!: string;
}

export class UpdateMediaMetaDto {
  @IsOptional()
  @IsString()
  @MaxLength(2200)
  caption?: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  altText?: string;

  @IsOptional()
  @IsString()
  accountId?: string | null;
}

export class ReplyMarketingMessageDto {
  @IsString()
  @MinLength(1)
  @MaxLength(2000)
  text!: string;
}

export class ListPostsQueryDto {
  @IsOptional()
  @IsString()
  accountId?: string;

  @IsOptional()
  @IsEnum(MarketingPostStatus)
  status?: MarketingPostStatus;
}
