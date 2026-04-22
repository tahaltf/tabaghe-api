import { IsBoolean, IsEnum, IsOptional, IsString } from 'class-validator';
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
}
