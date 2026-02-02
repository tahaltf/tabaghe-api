import { IsNotEmpty, IsOptional, IsString, Matches } from 'class-validator';

export class AuthDto {
  @IsString()
  @IsNotEmpty()
  @Matches(/^09\d{9}$/, { message: 'شماره موبایل معتبر نیست' })
  phone: string;

  @IsString()
  @IsOptional() // در مرحله اول اختیاری است، در مرحله دوم اجباری
  code?: string;
}
