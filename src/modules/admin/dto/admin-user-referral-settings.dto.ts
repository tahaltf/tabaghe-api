import { IsNumber, IsOptional, IsString, Max, Min, ValidateIf } from 'class-validator';

export class AdminUpdateUserReferralSettingsDto {
  /** کد دعوت سفارشی — حروف و عدد انگلیسی، ۳ تا ۲۰ کاراکتر */
  @IsOptional()
  @IsString({ message: 'کد دعوت باید متن باشد' })
  inviteCode?: string;

  /**
   * درصد پاداش دعوت اختصاصی (۰–۱۰۰).
   * null = بازگشت به پیش‌فرض سراسری
   */
  @IsOptional()
  @ValidateIf((_, v) => v !== null && v !== undefined)
  @IsNumber({}, { message: 'درصد پاداش باید عددی باشد' })
  @Min(0, { message: 'حداقل درصد ۰ است' })
  @Max(100, { message: 'حداکثر درصد ۱۰۰ است' })
  referralCommissionPercent?: number | null;
}
