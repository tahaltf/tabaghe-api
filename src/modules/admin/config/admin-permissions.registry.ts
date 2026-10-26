import { UserRole } from '@prisma/client';

export type AdminPermissionAction =
  | 'view'
  | 'create'
  | 'update'
  | 'delete'
  | 'approve';

export interface AdminPermissionDef {
  key: string;
  group: string;
  groupLabel: string;
  action: AdminPermissionAction;
  label: string;
  description?: string;
  sortOrder: number;
}

function defs(
  group: string,
  groupLabel: string,
  sortBase: number,
  actions: Array<{
    action: AdminPermissionAction;
    label: string;
    description?: string;
  }>,
): AdminPermissionDef[] {
  return actions.map((a, i) => ({
    key: `${group}.${a.action}`,
    group,
    groupLabel,
    action: a.action,
    label: a.label,
    description: a.description,
    sortOrder: sortBase + i,
  }));
}

/** کاتالوگ پرمیشن‌های قابل اختصاص به نقش‌های سفارشی (بدون صفحات حساس GODADMIN). */
export const ADMIN_PERMISSION_CATALOG: AdminPermissionDef[] = [
  ...defs('dashboard', 'داشبورد', 100, [
    { action: 'view', label: 'مشاهده داشبورد' },
  ]),
  ...defs('users', 'کاربران', 200, [
    { action: 'view', label: 'مشاهده کاربران' },
    { action: 'create', label: 'ایجاد کاربر' },
    { action: 'update', label: 'ویرایش کاربر' },
    { action: 'delete', label: 'حذف کاربر' },
  ]),
  ...defs('listings', 'آگهی‌ها', 300, [
    { action: 'view', label: 'مشاهده آگهی‌ها' },
    { action: 'create', label: 'ایجاد آگهی' },
    { action: 'update', label: 'ویرایش آگهی' },
    { action: 'delete', label: 'حذف آگهی' },
    { action: 'approve', label: 'تأیید / رد آگهی' },
  ]),
  ...defs('orders', 'سفارش‌ها و لجستیک', 400, [
    { action: 'view', label: 'مشاهده سفارش‌ها' },
    { action: 'update', label: 'تغییر وضعیت سفارش' },
  ]),
  ...defs('repairs', 'تعمیرات', 500, [
    { action: 'view', label: 'مشاهده درخواست‌های تعمیر' },
    { action: 'update', label: 'مدیریت درخواست تعمیر' },
  ]),
  ...defs('product_requests', 'درخواست‌های کالا', 550, [
    { action: 'view', label: 'مشاهده درخواست‌های کالا' },
  ]),
  ...defs('transactions', 'تراکنش‌ها', 600, [
    { action: 'view', label: 'مشاهده تراکنش‌ها' },
  ]),
  ...defs('wallet_requests', 'درخواست‌های مالی', 700, [
    { action: 'view', label: 'مشاهده درخواست‌های مالی' },
    { action: 'approve', label: 'تأیید / رد درخواست مالی' },
  ]),
  ...defs('platform_wallet', 'سود طبقه', 800, [
    { action: 'view', label: 'مشاهده سود طبقه' },
  ]),
  ...defs('coupons', 'کدهای تخفیف', 900, [
    { action: 'view', label: 'مشاهده کدها' },
    { action: 'create', label: 'ایجاد کد' },
    { action: 'update', label: 'ویرایش کد' },
    { action: 'delete', label: 'حذف کد' },
  ]),
  ...defs('tickets', 'تیکت‌های پشتیبانی', 1000, [
    { action: 'view', label: 'مشاهده تیکت‌ها' },
    { action: 'update', label: 'پاسخ / مدیریت تیکت' },
  ]),
  ...defs('disputes', 'شکایت‌ها و اختلافات', 1100, [
    { action: 'view', label: 'مشاهده شکایت‌ها' },
    { action: 'update', label: 'مدیریت شکایت' },
  ]),
  ...defs('contact_messages', 'پیام‌های تماس', 1200, [
    { action: 'view', label: 'مشاهده پیام‌ها' },
    { action: 'update', label: 'مدیریت پیام' },
  ]),
  ...defs('notifications', 'اطلاعیه‌ها', 1300, [
    { action: 'view', label: 'مشاهده اطلاعیه‌ها' },
    { action: 'create', label: 'ارسال اطلاعیه' },
    { action: 'update', label: 'ویرایش اطلاعیه' },
    { action: 'delete', label: 'حذف اطلاعیه' },
  ]),
  ...defs('listing_analytics', 'آمار بازدید آگهی', 1400, [
    { action: 'view', label: 'مشاهده آمار' },
  ]),
  ...defs('site_analytics', 'مانیتورینگ ترافیک', 1450, [
    { action: 'view', label: 'مشاهده مانیتورینگ ترافیک' },
    { action: 'update', label: 'همگام‌سازی و تنظیمات' },
  ]),
  ...defs('categories', 'دسته‌بندی‌ها', 1500, [
    { action: 'view', label: 'مشاهده دسته‌ها' },
    { action: 'create', label: 'ایجاد دسته' },
    { action: 'update', label: 'ویرایش دسته' },
    { action: 'delete', label: 'حذف دسته' },
  ]),
  ...defs('locations', 'استان و شهر', 1600, [
    { action: 'view', label: 'مشاهده مکان‌ها' },
    { action: 'create', label: 'ایجاد مکان' },
    { action: 'update', label: 'ویرایش مکان' },
    { action: 'delete', label: 'حذف مکان' },
  ]),
  ...defs('homepage', 'صفحه اصلی', 1700, [
    { action: 'view', label: 'مشاهده صفحه اصلی' },
    { action: 'update', label: 'ویرایش صفحه اصلی' },
  ]),
  ...defs('landing_pages', 'لندینگ‌ها', 1800, [
    { action: 'view', label: 'مشاهده لندینگ‌ها' },
    { action: 'create', label: 'ایجاد لندینگ' },
    { action: 'update', label: 'ویرایش لندینگ' },
    { action: 'delete', label: 'حذف لندینگ' },
  ]),
  ...defs('blog', 'بلاگ', 1900, [
    { action: 'view', label: 'مشاهده بلاگ' },
    { action: 'create', label: 'ایجاد مطلب' },
    { action: 'update', label: 'ویرایش مطلب' },
    { action: 'delete', label: 'حذف مطلب' },
  ]),
  ...defs('faqs', 'سوالات متداول', 2000, [
    { action: 'view', label: 'مشاهده FAQ' },
    { action: 'create', label: 'ایجاد FAQ' },
    { action: 'update', label: 'ویرایش FAQ' },
    { action: 'delete', label: 'حذف FAQ' },
  ]),
  ...defs('campaign_links', 'لینک‌های ردیابی', 2100, [
    { action: 'view', label: 'مشاهده لینک‌ها' },
    { action: 'create', label: 'ایجاد لینک' },
    { action: 'update', label: 'ویرایش لینک' },
    { action: 'delete', label: 'حذف لینک' },
  ]),
  ...defs('surveys', 'نظرسنجی معامله', 2200, [
    { action: 'view', label: 'مشاهده نظرسنجی‌ها' },
  ]),
  ...defs('customer_club', 'باشگاه مشتریان', 2300, [
    { action: 'view', label: 'مشاهده باشگاه' },
    { action: 'update', label: 'مدیریت باشگاه' },
  ]),
  ...defs('seller_crm', 'CRM فروشندگان', 2320, [
    { action: 'view', label: 'مشاهده CRM فروشندگان' },
    { action: 'create', label: 'ایجاد لید فروشنده' },
    { action: 'update', label: 'ویرایش / پیگیری لید' },
    { action: 'delete', label: 'حذف لید' },
  ]),
  ...defs('marketing', 'مارکتینگ', 2350, [
    { action: 'view', label: 'مشاهده مارکتینگ' },
    { action: 'create', label: 'ایجاد محتوا / پاسخ دایرکت' },
    { action: 'update', label: 'ویرایش محتوا / زمان‌بندی' },
    { action: 'delete', label: 'حذف / قطع اتصال حساب' },
  ]),
  ...defs('repair_hub', 'آدرس هاب تعمیرات', 2400, [
    { action: 'view', label: 'مشاهده آدرس‌ها' },
    { action: 'update', label: 'ویرایش آدرس‌ها' },
  ]),
  ...defs('plans', 'پلن‌های اشتراک', 2500, [
    { action: 'view', label: 'مشاهده پلن‌ها' },
    { action: 'create', label: 'ایجاد پلن' },
    { action: 'update', label: 'ویرایش پلن' },
    { action: 'delete', label: 'حذف پلن' },
  ]),
  ...defs('settings', 'تنظیمات سایت', 2600, [
    { action: 'view', label: 'مشاهده تنظیمات' },
    { action: 'update', label: 'ویرایش تنظیمات' },
  ]),
  ...defs('settings_secrets', 'کلیدهای سرور', 2650, [
    { action: 'view', label: 'مشاهده کلیدهای سرور' },
    { action: 'update', label: 'ویرایش کلیدهای سرور' },
  ]),
  ...defs('notification_settings', 'تنظیمات اطلاع‌رسانی', 2700, [
    { action: 'view', label: 'مشاهده تنظیمات اطلاع‌رسانی' },
    { action: 'update', label: 'ویرایش تنظیمات اطلاع‌رسانی' },
  ]),
  ...defs('fee_rules', 'قوانین کارمزد', 2800, [
    { action: 'view', label: 'مشاهده قوانین' },
    { action: 'create', label: 'ایجاد قانون' },
    { action: 'update', label: 'ویرایش قانون' },
    { action: 'delete', label: 'حذف قانون' },
  ]),
  ...defs('verification_fee_rules', 'قوانین کارشناسی', 2850, [
    { action: 'view', label: 'مشاهده قوانین کارشناسی' },
    { action: 'create', label: 'ایجاد قانون کارشناسی' },
    { action: 'update', label: 'ویرایش قانون کارشناسی' },
    { action: 'delete', label: 'حذف قانون کارشناسی' },
  ]),
  // DISABLED (قابل برگشت): دسترسی Gitea IP
  // ...defs('gitea_ip_allowlist', 'دسترسی Gitea (IP)', 2870, [
  //   { action: 'view', label: 'مشاهده لیست IP مجاز Gitea' },
  //   { action: 'create', label: 'افزودن IP مجاز' },
  //   { action: 'update', label: 'ویرایش / فعال‌سازی محدودیت' },
  //   { action: 'delete', label: 'حذف IP مجاز' },
  // ]),
  ...defs('crawler_ip_allowlist', 'دسترسی کرالر', 2875, [
    { action: 'view', label: 'مشاهده لیست IP مجاز کرالر' },
    { action: 'create', label: 'افزودن IP مجاز کرالر' },
    { action: 'update', label: 'ویرایش / فعال‌سازی محدودیت کرالر' },
    { action: 'delete', label: 'حذف IP مجاز کرالر' },
  ]),
  ...defs('auction_ops', 'عملیات مزایده', 2900, [
    { action: 'view', label: 'مشاهده عملیات مزایده' },
    { action: 'update', label: 'اجرای عملیات مزایده' },
  ]),
  ...defs('logs', 'لاگ‌های سیستم', 3000, [
    { action: 'view', label: 'مشاهده لاگ‌ها' },
  ]),
];

export const FULL_OPS_ROLE_SLUG = 'full-ops';
export const FULL_OPS_ROLE_NAME = 'ادمین کل';

export interface DefaultAdminRoleDef {
  slug: string;
  name: string;
  description: string;
  /** اگر null باشد یعنی همه پرمیشن‌های کاتالوگ */
  permissionKeys: string[] | null;
}

/** نقش‌های سیستمی پیش‌فرض که هنگام بالا آمدن API ساخته/سینک می‌شوند */
export const DEFAULT_ADMIN_ROLES: DefaultAdminRoleDef[] = [
  {
    slug: FULL_OPS_ROLE_SLUG,
    name: FULL_OPS_ROLE_NAME,
    description: 'دسترسی کامل عملیاتی به همه بخش‌های پنل (بدون صفحات حساس گاد ادمین)',
    permissionKeys: null,
  },
  {
    slug: 'listings-admin',
    name: 'ادمین آگهی',
    description: 'مدیریت آگهی‌ها، دسته‌ها، آمار بازدید و مشاهده کاربران',
    permissionKeys: [
      'dashboard.view',
      'listings.view',
      'listings.create',
      'listings.update',
      'listings.delete',
      'listings.approve',
      'categories.view',
      'categories.create',
      'categories.update',
      'locations.view',
      'listing_analytics.view',
      'site_analytics.view',
      'users.view',
    ],
  },
  {
    slug: 'finance-admin',
    name: 'ادمین مالی',
    description: 'مدیریت تراکنش‌ها، درخواست‌های مالی، سود طبقه، کد تخفیف و کارمزد',
    permissionKeys: [
      'dashboard.view',
      'transactions.view',
      'wallet_requests.view',
      'wallet_requests.approve',
      'platform_wallet.view',
      'coupons.view',
      'coupons.create',
      'coupons.update',
      'coupons.delete',
      'fee_rules.view',
      'fee_rules.create',
      'fee_rules.update',
      'fee_rules.delete',
      'verification_fee_rules.view',
      'verification_fee_rules.create',
      'verification_fee_rules.update',
      'verification_fee_rules.delete',
      'orders.view',
      'users.view',
    ],
  },
];

/** صفحات/مسیرهایی که فقط GODADMIN می‌بیند و در ماتریس نقش سفارشی نیست. */
export const ADMIN_ROUTE_PERMISSIONS = {
  godadminOnly: [
    '/admin/vault',
    '/admin/backup',
    '/admin/system-jobs',
    '/admin/server-monitor',
    '/admin/wordpress-plugin',
    '/admin/roles',
    // DISABLED: '/admin/gitea-ip-allowlist',
    '/admin/crawler-ip-allowlist',
  ],
  /** نگاشت مسیر فرانت → پرمیشن view لازم */
  routeViewPermission: {
    '/admin': 'dashboard.view',
    '/admin/users': 'users.view',
    '/admin/listings': 'listings.view',
    '/admin/listing-merge-requests': 'listings.view',
    '/admin/orders': 'orders.view',
    '/admin/inspection-orders': 'orders.view',
    '/admin/shipping-queue': 'orders.view',
    '/admin/repair-requests': 'repairs.view',
    '/admin/product-requests': 'product_requests.view',
    '/admin/transactions': 'transactions.view',
    '/admin/wallet-requests': 'wallet_requests.view',
    '/admin/platform-wallet': 'platform_wallet.view',
    '/admin/coupons': 'coupons.view',
    '/admin/tickets': 'tickets.view',
    '/admin/complaints': 'disputes.view',
    '/admin/contact-messages': 'contact_messages.view',
    '/admin/notifications': 'notifications.view',
    '/admin/listing-analytics': 'listing_analytics.view',
    '/admin/site-analytics': 'site_analytics.view',
    '/admin/categories': 'categories.view',
    '/admin/locations': 'locations.view',
    '/admin/homepage': 'homepage.view',
    '/admin/landing-pages': 'landing_pages.view',
    '/admin/blog-posts': 'blog.view',
    '/admin/faqs': 'faqs.view',
    '/admin/campaign-links': 'campaign_links.view',
    '/admin/surveys': 'surveys.view',
    '/admin/customer-club': 'customer_club.view',
    '/admin/seller-crm': 'seller_crm.view',
    '/admin/seller-crm/quick': 'seller_crm.view',
    '/admin/marketing': 'marketing.view',
    '/admin/marketing/accounts': 'marketing.view',
    '/admin/marketing/oauth-callback': 'marketing.view',
    '/admin/marketing/a': 'marketing.view',
    '/admin/marketing/content': 'marketing.view',
    '/admin/marketing/content/new': 'marketing.view',
    '/admin/marketing/inbox': 'marketing.view',
    '/admin/marketing/analytics': 'marketing.view',
    '/admin/marketing/scheduled': 'marketing.view',
    '/admin/repair-hub-addresses': 'repair_hub.view',
    '/admin/plans': 'plans.view',
    '/admin/settings': 'settings.view',
    '/admin/currencies': 'settings.view',
    '/admin/sms-panel': 'settings.view',
    '/admin/ai-content': 'settings.view',
    '/admin/restrictions': 'settings.view',
    '/admin/notification-settings': 'notification_settings.view',
    '/admin/fee-rules': 'fee_rules.view',
    '/admin/verification-fee-rules': 'verification_fee_rules.view',
    // DISABLED: '/admin/gitea-ip-allowlist': 'gitea_ip_allowlist.view',
    '/admin/crawler-ip-allowlist': 'crawler_ip_allowlist.view',
    '/admin/auction-ops': 'auction_ops.view',
    '/admin/logs': 'logs.view',
  } as const,
} as const;

export function isGodAdminRole(role: UserRole | string | undefined): boolean {
  return role === UserRole.GODADMIN;
}

export function allAssignablePermissionKeys(): string[] {
  return ADMIN_PERMISSION_CATALOG.map((p) => p.key);
}
