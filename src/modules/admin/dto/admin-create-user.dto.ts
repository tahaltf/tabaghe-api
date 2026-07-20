import { UserRole } from '@prisma/client';
import {
  IsBoolean,
  IsEnum,
  IsNotEmpty,
  IsOptional,
  IsString,
  Length,
  Matches,
} from 'class-validator';

export class AdminCreateUserDto {
  @IsString()
  @IsNotEmpty({ message: 'شماره موبایل الزامی است' })
  @Matches(/^09\d{9}$/, { message: 'فرمت شماره موبایل معتبر نیست' })
  phone!: string;

  @IsOptional()
  @IsString()
  @Length(8, 128, { message: 'رمز عبور باید بین ۸ تا ۱۲۸ کاراکتر باشد' })
  password?: string;

  @IsOptional()
  @IsString()
  firstName?: string;

  @IsOptional()
  @IsString()
  lastName?: string;

  @IsOptional()
  @IsEnum(UserRole, { message: 'نقش انتخاب‌شده معتبر نیست' })
  role?: UserRole;

  /** نقش سفارشی پنل — فقط وقتی role=ADMIN معنا دارد */
  @IsOptional()
  @IsString()
  adminRoleId?: string;

  @IsOptional()
  @IsBoolean({ message: 'مقدار فعال/غیرفعال باید بولی باشد' })
  isActive?: boolean;
}
