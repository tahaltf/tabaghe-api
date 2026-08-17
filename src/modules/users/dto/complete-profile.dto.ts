import { Transform } from 'class-transformer';
import {
  IsNotEmpty,
  IsOptional,
  IsString,
  Length,
  Matches,
  ValidateIf,
  IsDateString,
  MaxLength,
} from 'class-validator';
import { IsIranIban, IsIranNationalCode } from '../../../common/identity/iran-identifiers.util';

export class CompleteProfileDto {
  @IsOptional()
  @IsString()
  @ValidateIf((o) => String(o.firstName ?? '').trim().length > 0)
  @IsNotEmpty({ message: 'نام الزامی است' })
  firstName?: string;

  @IsOptional()
  @IsString()
  @ValidateIf((o) => String(o.lastName ?? '').trim().length > 0)
  @IsNotEmpty({ message: 'نام خانوادگی الزامی است' })
  lastName?: string;

  @IsOptional()
  @IsString()
  @MaxLength(80, { message: 'نام نمایشی حداکثر ۸۰ کاراکتر است' })
  displayName?: string;

  @IsString()
  @Length(10, 10, { message: 'کد ملی باید ۱۰ رقم باشد' })
  @Matches(/^\d{10}$/, { message: 'کد ملی فقط باید شامل اعداد باشد' })
  @IsIranNationalCode({ message: 'کد ملی نامعتبر است' })
  nationalCode!: string;

  @IsOptional()
  @ValidateIf((o) => o.shabaNumber !== '' && o.shabaNumber != null)
  @IsString()
  @Matches(/^(IR)?\d{24}$/i, { message: 'شماره شبا باید ۲۴ رقم باشد' })
  @IsIranIban({ message: 'شماره شبا نامعتبر است' })
  shabaNumber?: string;

  /** تاریخ تولد — در حالت استعلام خودکار الزامی است */
  @IsOptional()
  @IsDateString()
  birthDate?: string | null;

  /** کد معرف (اختیاری) — اگر وارد شود باید معتبر باشد؛ وگرنه خطا می‌دهد */
  @IsOptional()
  @Transform(({ value }) => {
    if (value == null || value === '') return undefined;
    if (typeof value !== 'string') return undefined;
    const trimmed = value.trim().slice(0, 32);
    return trimmed || undefined;
  })
  @IsString()
  @MaxLength(32, { message: 'کد معرف نامعتبر است' })
  referralCode?: string;
}
