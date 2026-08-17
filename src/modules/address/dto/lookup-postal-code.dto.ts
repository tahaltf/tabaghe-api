import { IsNotEmpty, IsString, Matches } from 'class-validator';

export class LookupPostalCodeDto {
  @IsString()
  @IsNotEmpty({ message: 'کد پستی الزامی است' })
  @Matches(/^\d{10}$/, { message: 'کد پستی باید ۱۰ رقم باشد' })
  postalCode!: string;
}
