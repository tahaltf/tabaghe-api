/** کلیدهای تنظیمات یادآوری مهلت اقدام (دقیقه قبل از پایان مهلت) */
export const DEADLINE_REMINDER_SETTING_KEYS = {
  defaultMinutes: 'ACTION_DEADLINE_REMINDER_DEFAULT_MINUTES',
  exchangePayment: 'ACTION_DEADLINE_REMINDER_EXCHANGE_PAYMENT_MINUTES',
  exchangeShipment: 'ACTION_DEADLINE_REMINDER_EXCHANGE_SHIPMENT_MINUTES',
  orderSellerShipment: 'ACTION_DEADLINE_REMINDER_ORDER_SELLER_SHIPMENT_MINUTES',
  auctionPayment: 'ACTION_DEADLINE_REMINDER_AUCTION_PAYMENT_MINUTES',
  /** @deprecated جایگزین: ACTION_DEADLINE_REMINDER_DEFAULT_MINUTES */
  legacyHours: 'ACTION_DEADLINE_REMINDER_HOURS',
} as const;

export type DeadlineReminderSettingKey =
  (typeof DEADLINE_REMINDER_SETTING_KEYS)[keyof typeof DEADLINE_REMINDER_SETTING_KEYS];

export const DEADLINE_REMINDER_ACTIONS = [
  'exchange_payment',
  'exchange_shipment',
  'order_seller_shipment',
  'auction_payment',
] as const;

export type DeadlineReminderAction =
  (typeof DEADLINE_REMINDER_ACTIONS)[number];

export const DEADLINE_REMINDER_ACTION_SETTING_KEY: Record<
  DeadlineReminderAction,
  string
> = {
  exchange_payment: DEADLINE_REMINDER_SETTING_KEYS.exchangePayment,
  exchange_shipment: DEADLINE_REMINDER_SETTING_KEYS.exchangeShipment,
  order_seller_shipment: DEADLINE_REMINDER_SETTING_KEYS.orderSellerShipment,
  auction_payment: DEADLINE_REMINDER_SETTING_KEYS.auctionPayment,
};

/** پیش‌فرض: ۱۲ ساعت قبل از پایان مهلت */
export const DEFAULT_DEADLINE_REMINDER_MINUTES = 12 * 60;

export const MAX_DEADLINE_REMINDER_MINUTES = 168 * 60;
