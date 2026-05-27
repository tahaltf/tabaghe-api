import {
  IsBoolean,
  IsEnum,
  IsIn,
  IsOptional,
  IsString,
  MaxLength,
  MinLength,
} from 'class-validator';
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
  CANCEL_AND_RETURN_BOTH_TO_SENDERS = 'CANCEL_AND_RETURN_BOTH_TO_SENDERS',
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
  @MinLength(3)
  @MaxLength(120)
  returnTrackingCodeToBuyer?: string;

  @IsOptional()
  @IsString()
  @MinLength(3)
  @MaxLength(120)
  returnTrackingCodeToSeller?: string;

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

/** نتیجه فنی هر کالا در هاب معاوضه */
export type ExchangeHubItemResult = 'PASS' | 'FAIL' | 'PASS_WITH_SETTLEMENT';

/** جمع‌بندی نهایی معاوضه پس از ثبت نتیجه هر دو کالا */
export type ExchangeHubResolution =
  | 'SHIP_TO_DESTINATIONS'
  | 'RETURN_BOTH_TO_SENDERS'
  | 'FINANCIAL_SETTLEMENT_THEN_SHIP';
export type ExchangeSettlementDirection = 'DEBIT' | 'CREDIT';

export class FinalizeExchangeHubInspectionDto {
  @IsString()
  @IsIn(['PASS', 'FAIL', 'PASS_WITH_SETTLEMENT'])
  listingItem!: ExchangeHubItemResult;

  @IsString()
  @IsIn(['PASS', 'FAIL', 'PASS_WITH_SETTLEMENT'])
  offerItem!: ExchangeHubItemResult;

  @IsString()
  @IsIn([
    'SHIP_TO_DESTINATIONS',
    'RETURN_BOTH_TO_SENDERS',
    'FINANCIAL_SETTLEMENT_THEN_SHIP',
  ])
  resolution!: ExchangeHubResolution;

  @IsOptional()
  @IsString()
  @MaxLength(800)
  listingNote?: string;

  @IsOptional()
  @IsString()
  @MaxLength(800)
  offerNote?: string;

  @IsOptional()
  @Type(() => Boolean)
  @IsBoolean()
  listingApplyPenalty?: boolean;

  @IsOptional()
  @Type(() => Boolean)
  @IsBoolean()
  offerApplyPenalty?: boolean;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(1)
  listingSettlementAmount?: number;

  @IsOptional()
  @IsString()
  @IsIn(['DEBIT', 'CREDIT'])
  listingSettlementDirection?: ExchangeSettlementDirection;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(1)
  offerSettlementAmount?: number;

  @IsOptional()
  @IsString()
  @IsIn(['DEBIT', 'CREDIT'])
  offerSettlementDirection?: ExchangeSettlementDirection;
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

export class SetExchangeHubReceiptDto {
  @IsString()
  @IsIn(['LISTING', 'OFFER'])
  side!: 'LISTING' | 'OFFER';

  @Type(() => Boolean)
  @IsBoolean()
  received!: boolean;
}

/** ادمین: طرف کد رهگیری زده ولی مرسوله واقعاً به هاب نرسیده */
export class RejectExchangeFakeShipmentDto {
  @IsString()
  @IsIn(['LISTING', 'OFFER'])
  side!: 'LISTING' | 'OFFER';

  @IsString()
  @MaxLength(500)
  note!: string;
}
