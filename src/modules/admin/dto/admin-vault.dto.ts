import { IsIn, IsString, MinLength } from 'class-validator';

export const VAULT_PURGE_TARGETS = [
  'listings',
  'users',
  'orders',
  'walletTransactions',
  'notifications',
  'tickets',
  'exchangeOffers',
  'repairs',
  'chats',
  'reviews',
  'quotaLedger',
  'planPurchases',
  'otpCodes',
  'idempotencyKeys',
  'contactMessages',
  'blogPosts',
  'faqs',
  'savedListings',
  'auctionData',
  'operationalAll',
] as const;

export type VaultPurgeTarget = (typeof VAULT_PURGE_TARGETS)[number];

export class VaultPurgeDto {
  @IsIn(VAULT_PURGE_TARGETS)
  target!: VaultPurgeTarget;

  /** باید دقیقاً برابر PURGE:<target> باشد، مثلاً PURGE:listings */
  @IsString()
  @MinLength(8)
  confirmPhrase!: string;
}
