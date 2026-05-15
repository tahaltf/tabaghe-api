/**
 * re-export تمام enum های دامنه از Prisma تا یک نقطه‌ی ورود مشترک داشته باشیم.
 * این همان فهرستی است که فرانت باید mirror کند.
 */
export {
  UserRole,
  UserStatus,
  ListingType,
  ListingStatus,
  OrderStatus,
  OrderType,
  ExchangePayer,
  PaymentMethod,
  ItemCondition,
  ShippingPayer,
  QuotaReason,
  QuotaAction,
  WalletTransactionType,
  WalletTransactionStatus,
  AuctionStatus,
  AuctionSettlementStatus,
  AuctionBidStatus,
  ExchangeOfferStatus,
  NotificationType,
  RepairRequestStatus,
  TicketStatus,
  OtpPurpose,
  LocationType,
} from '@prisma/client';

/**
 * کدهای خطای استاندارد API.
 * همین مقادیر در فرانت هم mirror می‌شوند.
 */
export enum ApiErrorCode {
  VALIDATION_ERROR = 'VALIDATION_ERROR',
  UNAUTHORIZED = 'UNAUTHORIZED',
  FORBIDDEN = 'FORBIDDEN',
  NOT_FOUND = 'NOT_FOUND',
  CONFLICT = 'CONFLICT',
  RATE_LIMITED = 'RATE_LIMITED',
  INTERNAL_ERROR = 'INTERNAL_ERROR',
  BAD_REQUEST = 'BAD_REQUEST',
  UNPROCESSABLE_ENTITY = 'UNPROCESSABLE_ENTITY',
  PAYLOAD_TOO_LARGE = 'PAYLOAD_TOO_LARGE',
}
