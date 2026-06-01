import { WalletTransactionStatus, WalletTransactionType } from '@prisma/client';

/**
 * Marker stored inside `WalletTransaction.meta.kind` to distinguish user-initiated
 * top-up requests (DEPOSIT + PENDING, awaiting admin approval) from escrow
 * deposits credited to sellers when a buyer pays.
 */
export const MANUAL_DEPOSIT_KIND = 'manual-deposit';
export const GATEWAY_TOPUP_KIND = 'gateway-topup';

export const ALLOWED_WALLET_META_KEYS = new Set([
  'kind',
  'phase',
  'description',
  'orderId',
  'listingId',
  'listingTitle',
  'auctionId',
  'refundReason',
  'debitReason',
  'receiptImageUrl',
  'rejectionReason',
  'adminNote',
  'repairTrackingCode',
  'paymentSource',
  'settlementKind',
  'agreementAmount',
]);

export type UserWalletTxFilter =
  | 'ALL'
  | 'INCOME'
  | 'EXPENSE'
  | 'BLOCKED'
  | 'PENDING';

export type WalletTxnRow = {
  id: string;
  type: WalletTransactionType;
  status: WalletTransactionStatus;
  amount: unknown;
  referenceId: string | null;
  createdAt: Date;
  meta: unknown;
};
