import { IsEnum, IsOptional, IsString, MaxLength, MinLength } from 'class-validator';
import { OrderStatus } from '@prisma/client';

export class UpdateOrderStatusDto {
  @IsEnum(OrderStatus)
  status!: OrderStatus;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  note?: string;
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
}

export class ResolveOrderEscrowDto {
  @IsEnum(AdminEscrowAction)
  action!: AdminEscrowAction;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  note?: string;
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
