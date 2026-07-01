import { ListingStatus } from '@prisma/client';

/** برچسب فارسی وضعیت آگهی — برای اعلان، SMS و UI */
export const LISTING_STATUS_LABELS_FA: Partial<Record<ListingStatus, string>> = {
  PENDING: 'در انتظار تایید',
  APPROVED: 'منتشر شده',
  REJECTED: 'رد شده',
  SOLD: 'فروخته شد',
  ARCHIVED: 'آرشیو شده',
  DELETED_BY_USER: 'حذف شده',
};

function normalizeStatusKey(status: string): string {
  return status
    .trim()
    .toUpperCase()
    .replace(/[\s-]+/g, '_');
}

export function getListingStatusLabelFa(
  status: string | null | undefined,
): string {
  if (!status?.trim()) return '';
  const raw = status.trim();
  if (/[\u0600-\u06FF]/.test(raw)) return raw;

  const normalized = normalizeStatusKey(raw);
  return LISTING_STATUS_LABELS_FA[normalized as ListingStatus] ?? raw;
}
