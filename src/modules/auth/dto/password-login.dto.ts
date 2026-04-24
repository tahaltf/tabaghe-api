import { IsNotEmpty, IsString, Length } from 'class-validator';

export class PasswordLoginDto {
  @IsString()
  @IsNotEmpty({ message: 'نام کاربری الزامی است' })
  @Length(3, 120, { message: 'نام کاربری نامعتبر است' })
  username!: string;

  @IsString()
  @IsNotEmpty({ message: 'رمز عبور الزامی است' })
  @Length(6, 128, { message: 'رمز عبور باید حداقل ۶ کاراکتر باشد' })
  password!: string;
}
