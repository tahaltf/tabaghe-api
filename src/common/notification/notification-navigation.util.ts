function metaString(
  meta: Record<string, unknown>,
  ...keys: string[]
): string {
  for (const key of keys) {
    const value = meta[key];
    if (typeof value === 'string' && value.trim()) return value.trim();
  }
  return '';
}

function entityBaseId(entityId: string): string {
  const colon = entityId.indexOf(':');
  return colon >= 0 ? entityId.slice(0, colon) : entityId;
}

export function isAdminOnlyNotificationType(type: string): boolean {
  return type.startsWith('ADMIN_ALERT_');
}

/**
 * مسیر SPA برای کلیک روی اعلان (in-app / push).
 * null یعنی فقط خوانده‌شدن — بدون ناوبری (مثلاً اعلان‌های ادمین).
 */
export function resolveNotificationPath(
  type: string,
  meta?: Record<string, unknown> | null,
): string | null {
  const m = meta ?? {};

  if (isAdminOnlyNotificationType(type)) {
    return null;
  }

  const explicitUrl = metaString(m, 'url');
  if (explicitUrl) {
    if (explicitUrl.startsWith('/') && !explicitUrl.startsWith('/admin/')) {
      return explicitUrl;
    }
    if (/^https?:\/\//i.test(explicitUrl)) {
      return explicitUrl;
    }
  }

  const ticketId = metaString(m, 'ticketId');
  if (ticketId || type === 'TICKET_REPLY') {
    return ticketId
      ? `/dashboard/support?ticketId=${ticketId}`
      : '/dashboard/support';
  }

  const repairId = metaString(m, 'repairRequestId', 'repairId');
  if (repairId || type === 'REPAIR_STATUS_CHANGED') {
    return repairId ? `/dashboard/repairs/${repairId}` : '/dashboard/repairs';
  }

  if (type.startsWith('WALLET_')) {
    return '/dashboard/wallet';
  }

  if (type === 'ACTION_DEADLINE_REMINDER') {
    const action = metaString(m, 'reminderAction');
    const listingId = metaString(m, 'listingId');
    const entityId = entityBaseId(metaString(m, 'entityId'));

    if (action === 'auction_payment' && listingId) {
      return `/listing/${listingId}`;
    }
    if (
      (action === 'exchange_payment' || action === 'exchange_shipment') &&
      listingId
    ) {
      return `/dashboard/exchange-requests/${listingId}`;
    }
    if (action === 'order_seller_shipment' && entityId) {
      return `/orders/${entityId}`;
    }
    if (entityId) {
      return `/orders/${entityId}`;
    }
    if (listingId) {
      return `/dashboard/exchange-requests/${listingId}`;
    }
  }

  if (type === 'POST_PURCHASE_SURVEY') {
    const surveyPath = metaString(m, 'url', 'surveyPath');
    if (surveyPath.startsWith('/')) return surveyPath;
    const surveyUrl = metaString(m, 'surveyUrl');
    if (surveyUrl) {
      try {
        const u = new URL(surveyUrl);
        return u.pathname + u.search;
      } catch {
        /* ignore */
      }
    }
  }

  const orderId = metaString(m, 'orderId');
  if (orderId || type === 'ORDER_STATUS_CHANGED' || type === 'BUY_NOW') {
    if (orderId) return `/orders/${orderId}`;
    return '/dashboard/orders/buy';
  }

  const listingId = metaString(m, 'listingId');

  if (
    type === 'EXCHANGE_OFFER_RECEIVED' ||
    type === 'EXCHANGE_OFFER_ACCEPTED' ||
    type === 'EXCHANGE_OFFER_REJECTED'
  ) {
    if (listingId) return `/dashboard/exchange-requests/${listingId}`;
    return '/dashboard/orders/requests';
  }

  if (
    type === 'AUCTION_WON' ||
    type === 'AUCTION_PAYMENT_REMINDER' ||
    type === 'AUCTION_LOST'
  ) {
    if (listingId) return `/listing/${listingId}`;
    return '/dashboard/orders/requests';
  }

  if (type === 'AUCTION_PENALIZED') {
    return '/dashboard/wallet';
  }

  if (
    type === 'LISTING_APPROVED' ||
    type === 'LISTING_REJECTED' ||
    type === 'LISTING_EXPIRY_REMINDER' ||
    type === 'LISTING_EXPIRED'
  ) {
    return '/dashboard/ads';
  }

  if (type === 'KYC_APPROVED' || type === 'KYC_REJECTED') {
    return '/dashboard/setting';
  }

  if (type === 'ADMIN_ANNOUNCEMENT') {
    return null;
  }

  if (listingId) {
    return `/listing/${listingId}`;
  }

  return null;
}
