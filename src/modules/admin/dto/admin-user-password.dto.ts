import { IsNotEmpty, IsString, Length } from 'class-validator';

export class AdminSetUserPasswordDto {
  @IsString()
  @IsNotEmpty({ message: 'رمز عبور الزامی است' })
  @Length(8, 128, { message: 'رمز عبور باید بین ۸ تا ۱۲۸ کاراکتر باشد' })
  password!: string;
}
