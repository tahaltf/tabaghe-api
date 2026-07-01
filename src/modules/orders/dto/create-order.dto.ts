import { IsBoolean, IsEnum, IsInt, IsOptional, IsString, Min } from 'class-validator';
import { Type } from 'class-transformer';
import { OrderType, PaymentMethod } from '@prisma/client';

export class CreateOrderDto {
  @IsOptional()
  @IsString()
  listingId?: string;

  @IsOptional()
  @IsString()
  addressId?: string;

  @IsEnum(OrderType)
  orderType!: OrderType;

  @IsEnum(PaymentMethod)
  paymentMethod!: PaymentMethod;

  @IsOptional()
  @IsString()
  exchangeOfferId?: string;

  @IsOptional()
  @IsString()
  exchangeRequestId?: string;

  @IsOptional()
  @IsBoolean()
  requiresVerification?: boolean;

  /** تعداد خرید در فروش مستقیم؛ پیش‌فرض ۱ */
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  quantity?: number;

  @IsOptional()
  @IsString()
  couponCode?: string;
}
