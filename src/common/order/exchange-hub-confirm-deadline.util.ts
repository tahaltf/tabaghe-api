export type ExchangeHubInspectionJson = Record<string, unknown>;

const BUYER_LEG_KEY = 'buyerLegConfirmDeadline';
const SELLER_LEG_KEY = 'sellerLegConfirmDeadline';

export function resolveExchangeLegConfirmDeadline(
  inspection: ExchangeHubInspectionJson | null | undefined,
  leg: 'BUYER' | 'SELLER',
  fallbackDeadline?: Date | string | null,
): Date | null {
  const key = leg === 'BUYER' ? BUYER_LEG_KEY : SELLER_LEG_KEY;
  const raw = inspection?.[key] ?? fallbackDeadline ?? null;
  if (!raw) return null;
  const parsed = raw instanceof Date ? raw : new Date(String(raw));
  return Number.isFinite(parsed.getTime()) ? parsed : null;
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
