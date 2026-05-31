import { IsBoolean, IsOptional } from 'class-validator';

export class SeedPlatformContentDto {
  /** بازنویسی قوانین، درباره ما، فوتر و معرفی حتی اگر پر باشند */
  @IsOptional()
  @IsBoolean()
  forceSettings?: boolean;

  /** حذف FAQهای فعلی و جایگزینی با پیش‌فرض */
  @IsOptional()
  @IsBoolean()
  forceFaqs?: boolean;
}
