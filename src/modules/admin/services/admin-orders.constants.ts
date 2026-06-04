import { OrderStatus } from '@prisma/client';
import { ORDER_STATUS_LABELS_FA } from '../../../common/order/order-status-labels.util';

export const EXCHANGE_INSPECTION_TICKET_TEMPLATE_KEYS = {
  BOTH_FAILED: 'EXCHANGE_INSPECTION_TICKET_TEMPLATE_BOTH_FAILED',
  OWN_FAILED: 'EXCHANGE_INSPECTION_TICKET_TEMPLATE_OWN_FAILED',
  OTHER_FAILED: 'EXCHANGE_INSPECTION_TICKET_TEMPLATE_OTHER_FAILED',
} as const;

export const STATUS_LABELS: Partial<Record<OrderStatus, string>> =
  ORDER_STATUS_LABELS_FA;
