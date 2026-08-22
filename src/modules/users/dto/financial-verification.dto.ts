import { Transform } from 'class-transformer';
import { IsOptional, IsString } from 'class-validator';

function digitsOnly(value: unknown): string {
  return String(value ?? '').replace(/\D/g, '');
}

export class FinancialVerificationDto {
  @Transform(({ value }) => digitsOnly(value))
  @IsString()
  cardNumber!: string;

  /** @deprecated — شبا از روی کارت با Zohal تبدیل می‌شود؛ از کلاینت پذیرفته نمی‌شود */
  @IsOptional()
  @IsString()
  shabaNumber?: string;
}

export class BankAccountDto extends FinancialVerificationDto {
  @IsOptional()
  @IsString()
  label?: string;
}
