import {
  IsBoolean,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  Length,
  Matches,
  Max,
  Min,
} from 'class-validator';

const IRANIAN_MOBILE = /^09\d{9}$/;

export class CrawlerPhoneDto {
  @IsString()
  @IsNotEmpty({ message: 'شماره موبایل الزامی است' })
  @Matches(IRANIAN_MOBILE, { message: 'شماره موبایل معتبر نیست' })
  phone!: string;
}

export class CrawlerCodeDto {
  @IsString()
  @IsNotEmpty({ message: 'کد تأیید الزامی است' })
  @Length(6, 6, { message: 'کد تأیید باید ۶ رقم باشد' })
  @Matches(/^\d{6}$/, { message: 'کد تأیید باید ۶ رقم باشد' })
  code!: string;
}

export class CrawlerSettingsDto {
  @IsString()
  @IsNotEmpty({ message: 'شماره موبایل الزامی است' })
  @Matches(IRANIAN_MOBILE, { message: 'شماره موبایل معتبر نیست' })
  login_phone!: string;

  @IsString()
  @IsNotEmpty({ message: 'شهر الزامی است' })
  city!: string;

  @IsString()
  @IsNotEmpty({ message: 'دسته الزامی است' })
  category!: string;

  @IsOptional()
  @IsBoolean()
  marketplace_only?: boolean;

  @IsOptional()
  @IsString()
  custom_list_url?: string;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(100)
  batch_size?: number;
}
