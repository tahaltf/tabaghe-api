export type ExchangeHubInspectionJson = Record<string, unknown>;

const BUYER_LEG_KEY = 'buyerLegConfirmDeadline';
const SELLER_LEG_KEY = 'sellerLegConfirmDeadline';

export function resolveExchangeLegConfirmDeadline(
  inspection: ExchangeHubInspectionJson | null | undefined,
  leg: 'BUYER' | 'SELLER',
  fallbackDeadline?: Date | string | null,
): Date | null {
  const key = leg === 'BUYER' ? BUYER_LEG_KEY : SELLER_LEG_KEY;
  const raw = inspection?.[key] ?? null;
  if (raw) {
    const parsed = raw instanceof Date ? raw : new Date(String(raw));
    return Number.isFinite(parsed.getTime()) ? parsed : null;
  }
  // اگر طرف دیگر مهلت جداگانه دارد، این طرف نباید از مهلت مشترک/قدیمی استفاده کند
  const otherKey = leg === 'BUYER' ? SELLER_LEG_KEY : BUYER_LEG_KEY;
  if (inspection?.[otherKey]) {
    return null;
  }
  if (!fallbackDeadline) return null;
  const parsed =
    fallbackDeadline instanceof Date
      ? fallbackDeadline
      : new Date(String(fallbackDeadline));
  return Number.isFinite(parsed.getTime()) ? parsed : null;
}

/** آیا این مسیر برای اولین بار از هاب ارسال می‌شود؟ */
export function isFirstHubShipmentForLeg(
  existingTracking: string | null | undefined,
  incomingTracking: string | undefined,
): boolean {
  const next = String(incomingTracking ?? '').trim();
  if (!next) return false;
  return !String(existingTracking ?? '').trim();
}

export function mergeExchangeLegConfirmDeadline(
  inspection: ExchangeHubInspectionJson | null | undefined,
  leg: 'BUYER' | 'SELLER',
  deadlineIso: string,
): ExchangeHubInspectionJson {
  const key = leg === 'BUYER' ? BUYER_LEG_KEY : SELLER_LEG_KEY;
  return {
    ...(inspection ?? {}),
    [key]: deadlineIso,
  };
}

export function isExchangeLegConfirmDeadlineExpired(
  params: {
    hubTrackingCode: string | null | undefined;
    alreadyConfirmed: boolean;
    inspection: ExchangeHubInspectionJson | null | undefined;
    leg: 'BUYER' | 'SELLER';
    fallbackDeadline?: Date | string | null;
  },
  now = Date.now(),
): boolean {
  if (params.alreadyConfirmed) return false;
  if (!String(params.hubTrackingCode ?? '').trim()) return false;
  const deadline = resolveExchangeLegConfirmDeadline(
    params.inspection,
    params.leg,
    params.fallbackDeadline,
  );
  if (!deadline) return false;
  return deadline.getTime() <= now;
}

/** آیا برای معاوضه، تایید خودکار حداقل یک طرف (با مهلت گذشته) لازم است؟ */
export function isExchangeAutoConfirmDue(
  order: {
    buyerConfirmDeadline?: Date | string | null;
    hubToBuyerTrackingCode?: string | null;
    hubToSellerTrackingCode?: string | null;
    buyerConfirmedDelivery?: boolean;
    sellerConfirmedDelivery?: boolean;
    exchangeHubInspection?: unknown;
  },
  now = Date.now(),
): boolean {
  const inspection = (order.exchangeHubInspection ??
    null) as ExchangeHubInspectionJson | null;
  const fallback = order.buyerConfirmDeadline ?? null;
  return (
    isExchangeLegConfirmDeadlineExpired(
      {
        hubTrackingCode: order.hubToBuyerTrackingCode,
        alreadyConfirmed: Boolean(order.buyerConfirmedDelivery),
        inspection,
        leg: 'BUYER',
        fallbackDeadline: fallback,
      },
      now,
    ) ||
    isExchangeLegConfirmDeadlineExpired(
      {
        hubTrackingCode: order.hubToSellerTrackingCode,
        alreadyConfirmed: Boolean(order.sellerConfirmedDelivery),
        inspection,
        leg: 'SELLER',
        fallbackDeadline: fallback,
      },
      now,
    )
  );
}
