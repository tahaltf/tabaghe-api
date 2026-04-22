import { IsNotEmpty, IsString, Length, Matches } from 'class-validator';

export class CompleteProfileDto {
  @IsString()
  @IsNotEmpty({ message: 'نام الزامی است' })
  firstName!: string;

  @IsString()
  @IsNotEmpty({ message: 'نام خانوادگی الزامی است' })
  lastName!: string;

  @IsString()
  @Length(10, 10, { message: 'کد ملی باید ۱۰ رقم باشد' })
  @Matches(/^\d{10}$/, { message: 'کد ملی فقط باید شامل اعداد باشد' })
  nationalCode!: string;

  @IsString()
  @IsNotEmpty({ message: 'شماره شبا الزامی است' })
  @Matches(/^(IR)?\d{24}$/i, { message: 'شماره شبا باید ۲۴ رقم باشد' })
  shabaNumber!: string;
}
