import { IsNotEmpty, IsString, Length, Matches } from 'class-validator';

export class AdminVerifyOtpDto {
  @IsString()
  @IsNotEmpty({ message: 'توکن ورود الزامی است' })
  challengeToken!: string;

  @IsString()
  @IsNotEmpty({ message: 'کد تایید الزامی است' })
  @Length(4, 6, { message: 'کد تایید نامعتبر است' })
  @Matches(/^\d+$/, { message: 'کد تایید باید عددی باشد' })
  code!: string;
}
