import { IsNotEmpty, IsString, Length, Matches } from 'class-validator';

const IRANIAN_MOBILE = /^09\d{9}$/;

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
}
