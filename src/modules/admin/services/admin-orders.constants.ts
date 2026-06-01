import { OrderStatus } from '@prisma/client';

export const EXCHANGE_INSPECTION_TICKET_TEMPLATE_KEYS = {
  BOTH_FAILED: 'EXCHANGE_INSPECTION_TICKET_TEMPLATE_BOTH_FAILED',
  OWN_FAILED: 'EXCHANGE_INSPECTION_TICKET_TEMPLATE_OWN_FAILED',
  OTHER_FAILED: 'EXCHANGE_INSPECTION_TICKET_TEMPLATE_OTHER_FAILED',
} as const;

export const STATUS_LABELS: Partial<Record<OrderStatus, string>> = {
  PENDING: 'در انتظار',
  AWAITING_PAYMENT: 'در انتظار پرداخت',
  PAID: 'پرداخت شد',
  AWAITING_SHIPMENT_TO_HUB: 'در انتظار ارسال به هاب',
  SHIPPED_TO_HUB: 'ارسال شده به هاب',
  RECEIVED_AT_HUB: 'تحویل هاب شد',
  CHECKING_AT_HUB: 'در حال بررسی در هاب',
  VERIFIED_AT_HUB: 'تایید در هاب',
  REJECTED_AT_HUB: 'رد شده در هاب',
  SHIPPED_TO_BUYER: 'ارسال به خریدار',
  SHIPPED: 'ارسال شد',
  DELIVERED: 'تحویل داده شد',
  RETURN_REQUESTED: 'در انتظار ثبت مرجوعی خریدار',
  RETURN_SHIPPED: 'مرجوعی توسط خریدار ارسال شد',
  COMPLETED: 'تکمیل شد',
  DISPUTED: 'اختلاف',
  CANCELLED: 'لغو شد',
};
