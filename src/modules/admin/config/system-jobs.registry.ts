export type SystemJobManagedBy = 'nestjs_cron' | 'nestjs_interval';

export interface SystemJobDefinition {
  id: string;
  name: string;
  schedule: string;
  scheduleLabel: string;
  description: string;
  module: string;
  method?: string;
  managedBy: SystemJobManagedBy;
  relatedSettingKeys: string[];
}

export const SYSTEM_JOBS_REGISTRY: SystemJobDefinition[] = [
  {
    id: 'auction_finalize',
    name: 'نهایی‌سازی مزایده‌های پایان‌یافته',
    schedule: '*/1 * * * *',
    scheduleLabel: 'هر ۱ دقیقه',
    description:
      'مزایده‌هایی که زمان پایانشان گذشته را نهایی می‌کند و برنده را ثبت می‌کند.',
    module: 'auction/auction.job.ts',
    method: 'autoFinalizeAuctions',
    managedBy: 'nestjs_cron',
    relatedSettingKeys: ['AUCTION_WINNER_PAYMENT_DEADLINE_HOURS'],
  },
  {
    id: 'auction_payment_timeouts',
    name: 'جریمه / لغو برندهٔ بدون پرداخت مزایده',
    schedule: '* * * * *',
    scheduleLabel: 'هر ۱ دقیقه',
    description:
      'برندگان مزایده‌ای که مهلت پرداخت را رد کرده‌اند را پردازش می‌کند (شانس دوم، جریمه و ...).',
    module: 'auction/auction.scheduler.ts',
    method: 'handleAuctionPaymentTimeouts',
    managedBy: 'nestjs_cron',
    relatedSettingKeys: [
      'AUCTION_WINNER_PAYMENT_DEADLINE_HOURS',
      'AUCTION_SECOND_CHANCE_PAYMENT_DEADLINE_HOURS',
    ],
  },
  {
    id: 'auction_expire_second_chance',
    name: 'انقضای پیشنهاد شانس دوم',
    schedule: '* * * * *',
    scheduleLabel: 'هر ۱ دقیقه',
    description: 'پیشنهادهای شانس دوم منقضی‌شده را EXPIRED می‌کند.',
    module: 'auction/auction.scheduler.ts',
    method: 'expireSecondChanceOffers',
    managedBy: 'nestjs_cron',
    relatedSettingKeys: ['AUCTION_SECOND_CHANCE_PAYMENT_DEADLINE_HOURS'],
  },
  {
    id: 'auction_health_eval',
    name: 'پایش سلامت عملیات مزایده',
    schedule: '* * * * *',
    scheduleLabel: 'هر ۱ دقیقه',
    description:
      'تعداد تسویه‌های معلق/شکست‌خورده را با آستانه مقایسه و در صورت نیاز هشدار ادمین می‌سازد.',
    module: 'auction/auction.scheduler.ts',
    method: 'evaluateAuctionOperationalHealth',
    managedBy: 'nestjs_cron',
    relatedSettingKeys: [
      'AUCTION_ALERT_PENDING_THRESHOLD',
      'AUCTION_ALERT_FAILED_THRESHOLD',
      'AUCTION_ALERT_COOLDOWN_MINUTES',
    ],
  },
  {
    id: 'auction_reconciliation',
    name: 'گزارش روزانه تطبیق مزایده',
    schedule: '10 2 * * *',
    scheduleLabel: 'هر روز ۰۲:۱۰',
    description: 'گزارش تطبیق وضعیت مزایده‌ها را در SystemSetting ذخیره می‌کند.',
    module: 'auction/auction.scheduler.ts',
    method: 'runDailyAuctionLedgerReconciliation',
    managedBy: 'nestjs_cron',
    relatedSettingKeys: [],
  },
  {
    id: 'auction_cleanup_keys',
    name: 'پاکسازی کلیدهای موقت مزایده',
    schedule: '20 3 * * *',
    scheduleLabel: 'هر روز ۰۳:۲۰',
    description: 'کلیدهای lease/health قدیمی مزایده را پاک می‌کند.',
    module: 'auction/auction.scheduler.ts',
    method: 'cleanupAuctionOperationalKeys',
    managedBy: 'nestjs_cron',
    relatedSettingKeys: [],
  },
  {
    id: 'notifications_deadline_reminders',
    name: 'یادآوری مهلت اقدامات (پیامک/سایت)',
    schedule: '*/15 * * * *',
    scheduleLabel: 'هر ۱۵ دقیقه',
    description:
      'اگر کمتر از مهلت تنظیم‌شده (پیش‌فرض ۱۲ ساعت) به پایان مهلت پرداخت/ارسال مانده و کار انجام نشده باشد، به کاربر مسئول نوتیف و در صورت فعال بودن قالب پیامک، SMS ارسال می‌شود.',
    module: 'notification/deadline-reminder.service.ts',
    method: 'runDeadlineReminders',
    managedBy: 'nestjs_cron',
    relatedSettingKeys: [
      'ACTION_DEADLINE_REMINDER_HOURS',
      'EXCHANGE_PAYMENT_DEADLINE_MINUTES',
      'EXCHANGE_SHIP_DEADLINE_MINUTES',
      'SELLER_SHIP_DEADLINE_MINUTES',
      'SMS_NOTIFICATION_RULES',
    ],
  },
  {
    id: 'orders_auto_cancel_expired',
    name: 'لغو سفارش به‌خاطر عدم ارسال در مهلت',
    schedule: '*/1 * * * *',
    scheduleLabel: 'هر ۱ دقیقه',
    description:
      'سفارش‌هایی که مهلت ارسالشان گذشته را لغو می‌کند (هم‌زمان با باز کردن صفحه سفارش)؛ در معاوضه جبران خسارت یک‌طرفه اعمال می‌شود.',
    module: 'orders/orders.service.ts',
    method: 'autoCancelExpiredOrders',
    managedBy: 'nestjs_cron',
    relatedSettingKeys: [
      'SELLER_SHIP_DEADLINE_MINUTES',
      'EXCHANGE_NO_SHIPMENT_COMPENSATION',
      'EXCHANGE_SHIP_DEADLINE_MINUTES',
      'EXCHANGE_SHIPMENT_TIMEOUT_HOURS',
    ],
  },
  {
    id: 'orders_exchange_payment_timeout',
    name: 'لغو معاوضهٔ بدون پرداخت / تاخیر پرداخت دوم',
    schedule: '0 * * * *',
    scheduleLabel: 'هر ۱ ساعت',
    description:
      'پیشنهادهای پذیرفته‌شده‌ای که هیچ‌کس پرداخت نکرده یا فقط یک طرف پرداخت کرده را لغو می‌کند.',
    module: 'orders/orders.service.ts',
    method: 'autoCancelTimedOutExchangeCompletions',
    managedBy: 'nestjs_cron',
    relatedSettingKeys: [
      'EXCHANGE_PAYMENT_DEADLINE_MINUTES',
      'EXCHANGE_NO_PAYMENT_TIMEOUT_HOURS',
      'EXCHANGE_SECOND_PAYMENT_TIMEOUT_HOURS',
    ],
  },
  {
    id: 'orders_seller_return_auto_confirm',
    name: 'تایید خودکار دریافت مرجوعی توسط فروشنده',
    schedule: '* * * * *',
    scheduleLabel: 'هر ۱ دقیقه',
    description:
      'سفارش‌های RETURN_SHIPPED که فروشنده در مهلت دریافت مرجوعی را تایید نکرده را خودکار تایید و بازگشت وجه می‌کند.',
    module: 'orders/orders.service.ts',
    method: 'autoConfirmSellerReturnReceipt',
    managedBy: 'nestjs_cron',
    relatedSettingKeys: [
      'SELLER_RETURN_CONFIRM_DEADLINE_MINUTES',
      'SELLER_RETURN_CONFIRM_DEADLINE_HOURS',
    ],
  },
  {
    id: 'orders_auto_confirm',
    name: 'تایید خودکار سفارش پس از مهلت خریدار',
    schedule: '* * * * *',
    scheduleLabel: 'هر ۱ دقیقه',
    description:
      'سفارش‌هایی که خریدار در مهلت تایید/شکایت نکرده را به‌صورت خودکار تکمیل می‌کند (بر اساس buyerConfirmDeadline).',
    module: 'orders/orders.service.ts',
    method: 'autoConfirmOrders',
    managedBy: 'nestjs_cron',
    relatedSettingKeys: ['BUYER_CONFIRM_DEADLINE_MINUTES'],
  },
  {
    id: 'orders_exchange_return_escrow',
    name: 'آزادسازی خودکار امانت بازگشت معاوضه',
    schedule: '0 * * * *',
    scheduleLabel: 'هر ۱ ساعت',
    description: 'پس از مهلت تایید بازگشت، امانت معاوضه را آزاد می‌کند.',
    module: 'orders/orders.service.ts',
    method: 'autoReleaseExchangeReturnEscrow',
    managedBy: 'nestjs_cron',
    relatedSettingKeys: ['EXCHANGE_RETURN_CONFIRM_DEADLINE_MINUTES'],
  },
  {
    id: 'repair_auto_complete',
    name: 'تکمیل خودکار تعمیر پس از ارسال برگشتی',
    schedule: '* * * * *',
    scheduleLabel: 'هر ۱ دقیقه',
    description:
      'درخواست‌های SHIPPED_BACK که کاربر پس از مهلت تایید دریافت (returnConfirmDeadline) نکرده را COMPLETED می‌کند.',
    module: 'repair/repair.service.ts',
    method: 'autoCompleteReturnedRepairs',
    managedBy: 'nestjs_cron',
    relatedSettingKeys: [
      'REPAIR_RETURN_CONFIRM_DEADLINE_MINUTES',
      'REPAIR_AUTO_COMPLETE_DAYS_AFTER_SHIP_BACK',
    ],
  },
  {
    id: 'backup_scheduled_tick',
    name: 'بک‌اپ زمان‌بندی‌شده دیتابیس',
    schedule: '@Interval(60000)',
    scheduleLabel: 'هر ۶۰ ثانیه (بررسی زمان اجرا)',
    description:
      'اگر زمان‌بندی بک‌اپ فعال باشد، در فاصلهٔ تنظیم‌شده pg_dump اجرا می‌شود. جزئیات در صفحه بک‌اپ.',
    module: 'admin/admin-backup.scheduler.ts',
    method: 'tick',
    managedBy: 'nestjs_interval',
    relatedSettingKeys: [],
  },
];
