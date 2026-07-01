import { Transform } from 'class-transformer';
import {
  IsBoolean,
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
  @MaxLength(80, { message: 'نام نمایشی حداکثر ۸۰ کاراکتر است' })
  displayName?: string;

  @IsOptional()
  @ValidateIf((o) => o.nationalCode !== '' && o.nationalCode != null)
  @IsString()
  @Length(10, 10, { message: 'کد ملی باید ۱۰ رقم باشد' })
  @Matches(/^\d{10}$/, { message: 'کد ملی فقط باید شامل اعداد باشد' })
  nationalCode?: string;

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
}
