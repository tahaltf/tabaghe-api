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

export class CompleteProfileDto {
  @IsString()
  @IsNotEmpty({ message: 'نام الزامی است' })
  firstName!: string;

  @IsString()
  @IsNotEmpty({ message: 'نام خانوادگی الزامی است' })
  lastName!: string;

  @IsOptional()
  @IsString()
  @MaxLength(80, { message: 'نام نمایشی حداکثر ۸۰ کاراکتر است' })
  displayName?: string;

  @IsString()
  @Length(10, 10, { message: 'کد ملی باید ۱۰ رقم باشد' })
  @Matches(/^\d{10}$/, { message: 'کد ملی فقط باید شامل اعداد باشد' })
  nationalCode!: string;

  @IsOptional()
  @ValidateIf((o) => o.shabaNumber !== '' && o.shabaNumber != null)
  @IsString()
  @Matches(/^(IR)?\d{24}$/i, { message: 'شماره شبا باید ۲۴ رقم باشد' })
  shabaNumber?: string;

  /** تاریخ تولد — اختیاری */
  @IsOptional()
  @IsDateString()
  birthDate?: string | null;
}
