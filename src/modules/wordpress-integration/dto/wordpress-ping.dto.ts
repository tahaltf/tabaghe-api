import { IsOptional, IsString, Matches, MaxLength } from 'class-validator';

export class WordPressPingDto {
  /** آدرس فروشگاه وردپرس؛ IsUrl سخت‌گیرانه برای دامنه/ساب‌فولدر/IDN اغلب fail می‌شود. */
  @IsString()
  @MaxLength(500)
  @Matches(/^https?:\/\/.+/i, {
    message: 'siteUrl must be a URL address',
  })
  siteUrl!: string;

  @IsOptional()
  @IsString()
  @MaxLength(32)
  pluginVersion?: string;

  @IsOptional()
  @IsString()
  @MaxLength(128)
  catalogSecret?: string;
}
