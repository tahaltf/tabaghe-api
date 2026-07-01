import { getListingStatusLabelFa } from '../listing/listing-status-labels.util';
import {
  getOrderStatusLabelFa,
  resolveOrderStatusLabelFromMeta,
} from '../order/order-status-labels.util';
import { getRepairStatusLabelFa } from '../repair/repair-status-labels.util';

/**
 * برچسب فارسی یکپارچه برای enumهای وضعیت (سفارش، آگهی، تعمیر).
 * ترتیب: Order → Listing → Repair → مقدار خام.
 */
export function resolveStatusLabelFa(
  status: string | null | undefined,
): string {
  if (!status?.trim()) return '';
  const raw = status.trim();
  if (/[\u0600-\u06FF]/.test(raw)) return raw;

  const orderLabel = getOrderStatusLabelFa(raw);
  if (orderLabel !== raw) return orderLabel;

  const listingLabel = getListingStatusLabelFa(raw);
  if (listingLabel !== raw) return listingLabel;

  const repairLabel = getRepairStatusLabelFa(raw);
  if (repairLabel !== raw) return repairLabel;

  return raw;
}

/** برچسب وضعیت با در نظر گرفتن meta (نوع موجودیت، فاز فروش، اصلاح مالی و ...) */
export function resolveStatusLabelFromMeta(
  meta: Record<string, unknown>,
): string {
  if (typeof meta.repairId === 'string' && meta.repairId.trim()) {
    const status =
      typeof meta.status === 'string' ? meta.status.trim() : '';
    if (status) {
      const repairLabel = getRepairStatusLabelFa(status);
      if (repairLabel !== status) return repairLabel;
    }
  }

  const phaseKey = String(meta.phaseKey ?? meta.phase ?? '').trim();
  if (phaseKey === 'sale_registered') {
    const status =
      typeof meta.status === 'string' ? meta.status.trim() : '';
    if (status) {
      const listingLabel = getListingStatusLabelFa(status);
      if (listingLabel !== status) return listingLabel;
    }
  }

  const fromOrderMeta = resolveOrderStatusLabelFromMeta(meta);
  const status = typeof meta.status === 'string' ? meta.status.trim() : '';
  if (!status || fromOrderMeta !== status) return fromOrderMeta;
  return resolveStatusLabelFa(status);
}
