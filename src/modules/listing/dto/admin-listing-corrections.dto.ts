import { IsOptional, IsString, MaxLength, MinLength } from 'class-validator';

/** اصلاحات اختیاری ادمین روی آگهی در انتظار تایید */
export class AdminListingCorrectionsDto {
  @IsOptional()
  @IsString()
  @MinLength(2)
  @MaxLength(200)
  title?: string;

  @IsOptional()
  @IsString()
  @MaxLength(8000)
  description?: string;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  desiredTitle?: string;

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  desiredDescription?: string;
}
