import { Transform } from 'class-transformer';
import {
  IsNotEmpty,
  IsOptional,
  IsString,
  Length,
  Matches,
} from 'class-validator';

const IRANIAN_MOBILE = /^09\d{9}$/;

/** Invalid/oversized referral must never fail OTP verify — drop it instead. */
function toOptionalReferralCode({ value }: { value: unknown }): string | undefined {
  if (value == null || value === '') return undefined;
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim().slice(0, 32);
  return trimmed || undefined;
}

export class RequestOtpDto {
  @IsString()
  @IsNotEmpty({ message: 'شماره موبایل الزامی است' })
  @Matches(IRANIAN_MOBILE, { message: 'شماره موبایل معتبر نیست' })
  phone!: string;
}

export class VerifyOtpDto {
  @IsString()
  @IsNotEmpty({ message: 'شماره موبایل الزامی است' })
  @Matches(IRANIAN_MOBILE, { message: 'شماره موبایل معتبر نیست' })
  phone!: string;

  @IsString()
  @IsNotEmpty({ message: 'کد تایید الزامی است' })
  @Length(4, 6, { message: 'کد تایید نامعتبر است' })
  code!: string;

  /** کد دعوت از لینک (?ref=) — اختیاری؛ خطا/نامعتبر بودن مانع ورود نیست */
  @IsOptional()
  @Transform(toOptionalReferralCode)
  @IsString()
  referralCode?: string;
}
