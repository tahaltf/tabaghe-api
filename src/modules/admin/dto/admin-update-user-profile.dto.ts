import { Transform } from 'class-transformer';
import {
  IsArray,
  IsBoolean,
  IsDateString,
  IsEmail,
  IsOptional,
  IsString,
  Length,
  Matches,
  MaxLength,
  ValidateIf,
} from 'class-validator';

function toOptionalBoolean(value: unknown): boolean | undefined {
  if (value === undefined || value === null || value === '') return undefined;
  if (value === true || value === 'true') return true;
  if (value === false || value === 'false') return false;
  return undefined;
}

export class AdminUpdateUserProfileDto {
  @IsOptional()
  @IsString()
  firstName?: string;

  @IsOptional()
  @IsString()
  lastName?: string;

  @IsOptional()
  @IsString()
  @MaxLength(80, { message: 'نام پدر حداکثر ۸۰ کاراکتر است' })
  fatherName?: string;

  @IsOptional()
  @IsString()
  @MaxLength(80, { message: 'نام نمایشی حداکثر ۸۰ کاراکتر است' })
  displayName?: string;

  @IsOptional()
  @ValidateIf((o) => o.phone !== '' && o.phone != null)
  @IsString()
  @Matches(/^09\d{9}$/, { message: 'فرمت شماره موبایل معتبر نیست' })
  phone?: string;

  @IsOptional()
  @ValidateIf((o) => o.nationalCode !== '' && o.nationalCode != null)
  @IsString()
  @Length(10, 10, { message: 'کد ملی باید ۱۰ رقم باشد' })
  @Matches(/^\d{10}$/, { message: 'کد ملی فقط باید شامل اعداد باشد' })
  nationalCode?: string;

  @IsOptional()
  @ValidateIf((o) => o.birthDate !== '' && o.birthDate != null)
  @IsDateString({}, { message: 'تاریخ تولد معتبر نیست' })
  birthDate?: string;

  @IsOptional()
  @ValidateIf((o) => o.shabaNumber !== '' && o.shabaNumber != null)
  @IsString()
  @Matches(/^(IR)?\d{24}$/i, { message: 'شماره شبا باید ۲۴ رقم باشد' })
  shabaNumber?: string;

  @IsOptional()
  @ValidateIf((o) => o.email !== '' && o.email != null)
  @IsEmail({}, { message: 'فرمت ایمیل صحیح نیست' })
  email?: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  bio?: string;

  @IsOptional()
  @IsString()
  avatar?: string;

  @IsOptional()
  @Transform(({ value }) => toOptionalBoolean(value))
  @IsBoolean()
  clearAvatar?: boolean;

  @IsOptional()
  @Transform(({ value }) => toOptionalBoolean(value))
  @IsBoolean()
  clearNationalCardImage?: boolean;

  /**
   * ارزهای مجاز برای قیمت‌گذاری آگهی (غیر از تومان).
   * آرایه خالی = فقط تومان. IRT همیشه مجاز است.
   */
  @IsOptional()
  @Transform(({ value }) => {
    if (value === undefined || value === null || value === '') return undefined;
    if (Array.isArray(value)) return value.map(String);
    if (typeof value === 'string') {
      try {
        const parsed = JSON.parse(value);
        if (Array.isArray(parsed)) return parsed.map(String);
      } catch {
        /* fall through */
      }
      return value
        .split(',')
        .map((s: string) => s.trim())
        .filter(Boolean);
    }
    return undefined;
  })
  @IsArray()
  @IsString({ each: true })
  allowedListingCurrencyCodes?: string[];
}
