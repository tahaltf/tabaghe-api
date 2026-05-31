import { UserRole } from '@prisma/client';

/**
 * مرجع سطح دسترسی پنل ادمین.
 * GODADMIN: vault, backup, system-jobs, server-monitor, حذف/ایجاد دسته (برخی عملیات)
 * ADMIN: سایر بخش‌های عملیاتی
 */
export const ADMIN_ROUTE_PERMISSIONS = {
  godadminOnly: [
    '/admin/vault',
    '/admin/backup',
    '/admin/system-jobs',
    '/admin/server-monitor',
  ],
  adminAndGodadmin: [
    '/admin',
    '/admin/users',
    '/admin/listings',
    '/admin/orders',
    '/admin/wallet-requests',
    '/admin/platform-wallet',
    '/admin/settings',
    '/admin/notification-settings',
    '/admin/fee-rules',
    '/admin/auction-ops',
    '/admin/logs',
  ],
} as const;

export function isGodAdminRole(role: UserRole | string | undefined): boolean {
  return role === UserRole.GODADMIN;
}
