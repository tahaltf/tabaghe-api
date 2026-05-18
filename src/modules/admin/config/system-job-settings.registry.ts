export type SystemJobSettingType = 'number' | 'boolean' | 'string';

export type SystemJobSettingUnit =
  | 'minutes'
  | 'hours'
  | 'days'
  | 'toman'
  | 'count'
  | '';

export interface SystemJobSettingGroup {
  id: string;
  label: string;
  description: string;
}

export interface SystemJobSettingDefinition {
  key: string;
  label: string;
  description: string;
  groupId: string;
  type: SystemJobSettingType;
  defaultValue: string;
  unit: SystemJobSettingUnit;
  min?: number;
  max?: number;
}

export const SYSTEM_JOB_SETTING_GROUPS: SystemJobSettingGroup[] = [
  {
    id: 'orders',
    label: 'سفارش و مهلت ارسال/تایید',
    description: 'مهلت‌های فروش، خرید و ارسال به هاب',
  },
  {
    id: 'exchange',
    label: 'معاوضه',
    description: 'پرداخت، ارسال و بازگشت کالا در معاوضه',
  },
  {
    id: 'auction',
    label: 'مزایده',
    description: 'مهلت پرداخت برنده، شانس دوم و آستانه‌های هشدار',
  },
  {
    id: 'repair',
    label: 'تعمیرات',
    description: 'تکمیل خودکار پس از ارسال برگشتی',
  },
];

export const SYSTEM_JOB_SETTINGS_REGISTRY: SystemJobSettingDefinition[] = [
  {
    key: 'SELLER_SHIP_DEADLINE_MINUTES',
    label: 'مهلت ارسال فروشنده',
    description: 'پس از پرداخت، فروشنده چند دقیقه برای ثبت ارسال فرصت دارد.',
    groupId: 'orders',
    type: 'number',
    defaultValue: '4320',
    unit: 'minutes',
    min: 60,
    max: 60 * 24 * 30,
  },
  {
    key: 'BUYER_CONFIRM_DEADLINE_MINUTES',
    label: 'مهلت تایید خریدار',
    description:
      'پس از ارسال به خریدار، چند دقیقه برای تایید دریافت یا ثبت شکایت.',
    groupId: 'orders',
    type: 'number',
    defaultValue: '5760',
    unit: 'minutes',
    min: 60,
    max: 60 * 24 * 30,
  },
  {
    key: 'ACTION_DEADLINE_REMINDER_HOURS',
    label: 'یادآوری پیامکی/سایت — کمتر از X ساعت به مهلت',
    description:
      'اگر تا پایان مهلت یک اقدام (پرداخت، ارسال و ...) کمتر از این تعداد ساعت مانده و کار انجام نشده باشد، به طرف مسئول اطلاع داده می‌شود.',
    groupId: 'notifications',
    type: 'number',
    defaultValue: '12',
    unit: 'hours',
    min: 1,
    max: 168,
  },
  {
    key: 'EXCHANGE_NO_SHIPMENT_COMPENSATION',
    label: 'جبران عدم ارسال در معاوضه (درصد)',
    description:
      'درصد مبلغ قابل جبران به طرفی که ارسال کرده و طرف مقابل ارسال نکرده.',
    groupId: 'exchange',
    type: 'number',
    defaultValue: '20',
    unit: 'count',
    min: 0,
    max: 100,
  },
  {
    key: 'EXCHANGE_PAYMENT_DEADLINE_MINUTES',
    label: 'مهلت پرداخت معاوضه (دقیقه)',
    description:
      'پس از پذیرش پیشنهاد، هر دو طرف تا این زمان برای تکمیل پرداخت سهم خود فرصت دارند.',
    groupId: 'exchange',
    type: 'number',
    defaultValue: '1440',
    unit: 'minutes',
    min: 1,
    max: 24 * 60 * 14,
  },
  {
    key: 'EXCHANGE_NO_PAYMENT_TIMEOUT_HOURS',
    label: 'مهلت شروع پرداخت معاوضه (قدیمی)',
    description:
      'فقط اگر EXCHANGE_PAYMENT_DEADLINE_MINUTES تنظیم نشده باشد، به‌عنوان جایگزین (ساعت) استفاده می‌شود.',
    groupId: 'exchange',
    type: 'number',
    defaultValue: '24',
    unit: 'hours',
    min: 1,
    max: 24 * 14,
  },
  {
    key: 'EXCHANGE_SECOND_PAYMENT_TIMEOUT_HOURS',
    label: 'مهلت پرداخت دوم معاوضه',
    description:
      'وقتی یک طرف پرداخت کرده و طرف دیگر نه، چند ساعت تا لغو و بازپرداخت.',
    groupId: 'exchange',
    type: 'number',
    defaultValue: '48',
    unit: 'hours',
    min: 1,
    max: 24 * 14,
  },
  {
    key: 'EXCHANGE_SHIP_DEADLINE_MINUTES',
    label: 'مهلت ارسال معاوضه (دقیقه)',
    description:
      'پس از تکمیل پرداخت هر دو طرف، مهلت ثبت ارسال؛ پس از ارسال نفر اول، همین مهلت برای طرف دوم تمدید می‌شود.',
    groupId: 'exchange',
    type: 'number',
    defaultValue: '4320',
    unit: 'minutes',
    min: 60,
    max: 60 * 24 * 30,
  },
  {
    key: 'EXCHANGE_SHIPMENT_TIMEOUT_HOURS',
    label: 'مهلت ارسال معاوضه (قدیمی، ساعت)',
    description:
      'فقط اگر EXCHANGE_SHIP_DEADLINE_MINUTES تنظیم نشده باشد به‌عنوان جایگزین استفاده می‌شود.',
    groupId: 'exchange',
    type: 'number',
    defaultValue: '48',
    unit: 'hours',
    min: 1,
    max: 24 * 14,
  },
  {
    key: 'EXCHANGE_RETURN_CONFIRM_DEADLINE_MINUTES',
    label: 'مهلت تایید بازگشت معاوضه',
    description: 'پس از ثبت کد رهگیری بازگشت، مهلت تایید طرف مقابل (دقیقه).',
    groupId: 'exchange',
    type: 'number',
    defaultValue: '2880',
    unit: 'minutes',
    min: 60,
    max: 60 * 24 * 30,
  },
  {
    key: 'AUCTION_WINNER_PAYMENT_DEADLINE_HOURS',
    label: 'مهلت پرداخت برنده مزایده',
    description: 'برنده چند ساعت پس از پایان مزایده برای پرداخت فرصت دارد.',
    groupId: 'auction',
    type: 'number',
    defaultValue: '48',
    unit: 'hours',
    min: 1,
    max: 24 * 14,
  },
  {
    key: 'AUCTION_SECOND_CHANCE_PAYMENT_DEADLINE_HOURS',
    label: 'مهلت پرداخت شانس دوم',
    description: 'مدت اعتبار پیشنهاد شانس دوم برای خریدار جایگزین (ساعت).',
    groupId: 'auction',
    type: 'number',
    defaultValue: '24',
    unit: 'hours',
    min: 1,
    max: 24 * 7,
  },
  {
    key: 'AUCTION_ALERT_PENDING_THRESHOLD',
    label: 'آستانه تسویه معلق',
    description: 'بیش از این تعداد، هشدار سلامت مزایده فعال می‌شود.',
    groupId: 'auction',
    type: 'number',
    defaultValue: '30',
    unit: 'count',
    min: 1,
    max: 10000,
  },
  {
    key: 'AUCTION_ALERT_FAILED_THRESHOLD',
    label: 'آستانه تسویه شکست‌خورده',
    description: 'بیش از این تعداد FAILED، وضعیت بحرانی گزارش می‌شود.',
    groupId: 'auction',
    type: 'number',
    defaultValue: '5',
    unit: 'count',
    min: 1,
    max: 10000,
  },
  {
    key: 'AUCTION_ALERT_COOLDOWN_MINUTES',
    label: 'فاصله بین هشدارهای مزایده',
    description: 'حداقل فاصله بین دو هشدار سلامت عملیات (دقیقه).',
    groupId: 'auction',
    type: 'number',
    defaultValue: '30',
    unit: 'minutes',
    min: 5,
    max: 24 * 60,
  },
  {
    key: 'AUCTION_MAX_BIDS_PER_MINUTE',
    label: 'حداکثر پیشنهاد در دقیقه',
    description: 'محدودیت نرخ ثبت پیشنهاد برای هر کاربر.',
    groupId: 'auction',
    type: 'number',
    defaultValue: '10',
    unit: 'count',
    min: 1,
    max: 1000,
  },
  {
    key: 'SELLER_RETURN_CONFIRM_DEADLINE_MINUTES',
    label: 'مهلت تایید دریافت مرجوعی توسط فروشنده (دقیقه)',
    description:
      'پس از ثبت مرجوعی توسط خریدار، اگر فروشنده دریافت را تایید نکند، پس از این مدت به‌صورت خودکار تایید و بازگشت وجه انجام می‌شود.',
    groupId: 'orders',
    type: 'number',
    defaultValue: '4320',
    unit: 'minutes',
    min: 60,
    max: 43200,
  },
  {
    key: 'REPAIR_RETURN_CONFIRM_DEADLINE_MINUTES',
    label: 'مهلت تایید دریافت تعمیر پس از ارسال برگشتی (دقیقه)',
    description:
      'پس از ثبت ارسال برگشتی توسط ادمین، اگر صاحب کالا تایید دریافت نزند، بعد از این مدت به‌صورت خودکار تکمیل می‌شود.',
    groupId: 'repair',
    type: 'number',
    defaultValue: '4320',
    unit: 'minutes',
    min: 60,
    max: 43200,
  },
  {
    key: 'REPAIR_AUTO_COMPLETE_DAYS_AFTER_SHIP_BACK',
    label: 'تکمیل خودکار تعمیر (روز) — پشتیبان',
    description:
      'فقط برای رکوردهای قدیمی بدون مهلت دقیق؛ در صورت تنظیم دقیقهٔ بالا معمولاً استفاده نمی‌شود.',
    groupId: 'repair',
    type: 'number',
    defaultValue: '3',
    unit: 'days',
    min: 1,
    max: 30,
  },
];

export const SYSTEM_JOB_SETTING_KEYS = new Set(
  SYSTEM_JOB_SETTINGS_REGISTRY.map((s) => s.key),
);

export function getSystemJobSettingDef(
  key: string,
): SystemJobSettingDefinition | undefined {
  return SYSTEM_JOB_SETTINGS_REGISTRY.find((s) => s.key === key);
}
