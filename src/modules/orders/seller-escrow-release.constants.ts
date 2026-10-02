export const SELLER_ESCROW_RELEASE_REASON = {
  TRUSTED_SHIPMENT: 'TRUSTED_SHIPMENT',
  HUB_VERIFIED: 'HUB_VERIFIED',
  BUYER_CONFIRM: 'BUYER_CONFIRM',
  AUTO_CONFIRM: 'AUTO_CONFIRM',
  ADMIN: 'ADMIN',
} as const;

export type SellerEscrowReleaseReason =
  (typeof SELLER_ESCROW_RELEASE_REASON)[keyof typeof SELLER_ESCROW_RELEASE_REASON];

export const RELEASE_ESCROW_ON_HUB_VERIFIED_KEY =
  'RELEASE_ESCROW_ON_HUB_VERIFIED';

export function sellerEscrowReleaseDescription(
  titleQuoted: string,
  reason?: string,
): string {
  switch (reason) {
    case SELLER_ESCROW_RELEASE_REASON.TRUSTED_SHIPMENT:
      return `آزادسازی درآمد فروش برای ${titleQuoted}: مبلغ از «بلوکه‌شده» به موجودی قابل برداشت منتقل شد چون فروشنده مورد اعتماد پس از ارسال به خریدار تسویه زودهنگام دارد.`;
    case SELLER_ESCROW_RELEASE_REASON.HUB_VERIFIED:
      return `آزادسازی درآمد فروش برای ${titleQuoted}: مبلغ از «بلوکه‌شده» به موجودی قابل برداشت منتقل شد چون کارشناسی هاب تایید شد.`;
    case SELLER_ESCROW_RELEASE_REASON.ADMIN:
      return `آزادسازی درآمد فروش برای ${titleQuoted}: مبلغ از «بلوکه‌شده» به موجودی قابل برداشت منتقل شد با دستور ادمین.`;
    case SELLER_ESCROW_RELEASE_REASON.AUTO_CONFIRM:
      return `آزادسازی درآمد فروش برای ${titleQuoted}: مبلغ از «بلوکه‌شده» به موجودی قابل برداشت منتقل شد چون مهلت تایید خریدار به پایان رسید.`;
    case SELLER_ESCROW_RELEASE_REASON.BUYER_CONFIRM:
    default:
      return `آزادسازی درآمد فروش برای ${titleQuoted}: مبلغ از «بلوکه‌شده» به موجودی قابل برداشت منتقل شد چون خریدار دریافت کالا را تأیید کرد.`;
  }
}
