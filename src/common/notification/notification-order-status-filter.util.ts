/** فیلتر وضعیت سفارش در قوانین ORDER_STATUS_CHANGED — undefined/خالی = همه فعال (سازگاری عقب‌رو) */
export function isOrderStatusNotificationEnabled(
  rule: { enabledOrderStatuses?: string[] } | null | undefined,
  meta: Record<string, unknown>,
): boolean {
  const enabled = rule?.enabledOrderStatuses;
  if (enabled === undefined || enabled === null) return true;
  if (enabled.length === 0) return false;

  const status = String(meta['status'] ?? '')
    .trim()
    .toUpperCase();
  if (!status) return true;

  return enabled.some((s) => s.trim().toUpperCase() === status);
}
