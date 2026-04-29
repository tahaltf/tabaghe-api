import { IsEnum, IsOptional, IsString, MaxLength, MinLength } from 'class-validator';
import { OrderStatus } from '@prisma/client';
import { Type } from 'class-transformer';
import { IsNumber, Min } from 'class-validator';

export class UpdateOrderStatusDto {
  @IsEnum(OrderStatus)
  status!: OrderStatus;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  note?: string;

  @IsOptional()
  @IsString()
  @MinLength(3)
  @MaxLength(120)
  rejectedReturnTrackingCode?: string;
}

export class UpdateTrackingCodeDto {
  @IsString()
  @MinLength(3)
  @MaxLength(120)
  trackingCode!: string;
}

export enum AdminEscrowAction {
  RELEASE_TO_SELLER = 'RELEASE_TO_SELLER',
  REFUND_TO_BUYER = 'REFUND_TO_BUYER',
  PARTIAL_REFUND_AND_CONTINUE = 'PARTIAL_REFUND_AND_CONTINUE',
  REQUEST_RETURN_FROM_BUYER = 'REQUEST_RETURN_FROM_BUYER',
  CONFIRM_RETURN_AND_REFUND = 'CONFIRM_RETURN_AND_REFUND',
}

export class ResolveOrderEscrowDto {
  @IsEnum(AdminEscrowAction)
  action!: AdminEscrowAction;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  note?: string;

  @IsOptional()
  @IsNumber()
  @Min(0)
  @Type(() => Number)
  refundToBuyerAmount?: number;

  @IsOptional()
  @IsString()
  @MinLength(3)
  @MaxLength(120)
  returnTrackingCode?: string;

  @IsOptional()
  @IsString()
  @MaxLength(600)
  returnAddress?: string;

  @IsOptional()
  @IsString()
  @MaxLength(20)
  returnPostalCode?: string;
}

export class SetHubShippingCodesDto {
  @IsOptional()
  @IsString()
  @MinLength(3)
  @MaxLength(120)
  hubToBuyerTrackingCode?: string;

  @IsOptional()
  @IsString()
  @MinLength(3)
  @MaxLength(120)
  hubToSellerTrackingCode?: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  note?: string;
}

export class SetParticipantShippingDto {
  @IsOptional()
  @IsString()
  @MinLength(3)
  @MaxLength(120)
  sellerTrackingCode?: string;

  @IsOptional()
  @IsString()
  @MinLength(3)
  @MaxLength(120)
  buyerTrackingCode?: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  sellerNote?: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  buyerNote?: string;
}
