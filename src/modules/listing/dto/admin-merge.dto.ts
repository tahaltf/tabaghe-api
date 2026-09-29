import { IsArray, IsOptional, IsString, ArrayMinSize, MinLength } from 'class-validator';

export class AdminApproveMergeRequestDto {
  @IsOptional()
  @IsString()
  @MinLength(1)
  targetListingId?: string;

  @IsOptional()
  @IsString()
  adminNote?: string;
}

export class AdminRejectMergeRequestDto {
  @IsOptional()
  @IsString()
  adminNote?: string;
}

export class AdminDirectMergeDto {
  @IsArray()
  @ArrayMinSize(2)
  @IsString({ each: true })
  listingIds!: string[];

  /** آگهی لنگر / مقصد؛ اگر خالی باشد اولین آیتم استفاده می‌شود */
  @IsOptional()
  @IsString()
  @MinLength(1)
  targetListingId?: string;
}
