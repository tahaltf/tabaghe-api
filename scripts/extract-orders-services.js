/** Extract OrdersService into focused services (UTF-8 safe). */
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const srcPath = path.join(root, 'src/modules/orders/orders.service.ts');
const lines = fs.readFileSync(srcPath, 'utf8').replace(/\r\n/g, '\n').split('\n');

function slice(start, end) {
  return lines.slice(start - 1, end).join('\n');
}

function transformBody(body) {
  return body
    .replace(/\bOrdersService\./g, '')
    .replace(/this\.getSellerReturnConfirmDeadlineMinutes\(\)/g, 'this.settings.getSellerReturnConfirmDeadlineMinutes()')
    .replace(/this\.getSellerShipDeadlineMinutes\(\)/g, 'this.settings.getSellerShipDeadlineMinutes()')
    .replace(/this\.getExchangeShipmentDeadlineMinutes\(\)/g, 'this.settings.getExchangeShipmentDeadlineMinutes()')
    .replace(/this\.getExchangeShipmentTimeoutHours\(\)/g, 'this.settings.getExchangeShipmentTimeoutHours()')
    .replace(/this\.getBuyerConfirmDeadlineMinutes\(\)/g, 'this.settings.getBuyerConfirmDeadlineMinutes()')
    .replace(/this\.getExchangeNoShipmentCompensation\(\)/g, 'this.settings.getExchangeNoShipmentCompensation()')
    .replace(/this\.getExchangePaymentTrustPenalty\(/g, 'this.settings.getExchangePaymentTrustPenalty(')
    .replace(/this\.getExchangePaymentDeadlineMinutes\(\)/g, 'this.settings.getExchangePaymentDeadlineMinutes()')
    .replace(/this\.getExchangeNoPaymentTimeoutHours\(\)/g, 'this.settings.getExchangeNoPaymentTimeoutHours()')
    .replace(/this\.getExchangeSecondPaymentTimeoutHours\(\)/g, 'this.settings.getExchangeSecondPaymentTimeoutHours()')
    .replace(/this\.getExchangeReturnConfirmDeadlineMinutes\(\)/g, 'this.settings.getExchangeReturnConfirmDeadlineMinutes()')
    .replace(/this\.getOrderVideoRetentionDays\(\)/g, 'this.settings.getOrderVideoRetentionDays()')
    .replace(/this\.resolveEffectiveShippingDeadline\(/g, 'this.settings.resolveEffectiveShippingDeadline(');
}

const prismaImports = `import { Inject, Injectable, forwardRef } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import {
  AuctionBidStatus,
  AuctionSettlementStatus,
  AuctionStatus,
  ExchangeOfferStatus,
  ListingStatus,
  ListingType,
  NotificationType,
  OrderStatus,
  OrderType,
  Prisma,
  SecondChanceOfferStatus,
  UserRole,
  WalletTransactionStatus,
  WalletTransactionType,
} from '@prisma/client';
import Decimal from 'decimal.js';
import { PrismaService } from '../../../infrastructure/prisma/prisma.service';
import { readPositiveIntSetting } from '../../../common/system-settings/numeric-setting.util';
import { WalletService } from '../../wallet/wallet.service';
import { FeeCalculatorService } from '../../fees/fee-calculator.service';
import { AppSettingsService } from '../../../shared/settings/app-settings.service';
import { PaymentsService } from '../../payments/payments.service';
import { NotificationService } from '../../notification/notification.service';
import { ExchangeOrderNotifyService } from '../../notification/exchange-order-notify.service';
import { OrderReputationService } from '../../order-reputation.service';
import { ExchangeService } from '../../exchange/exchange.service';
import { QuotaService } from '../../quota/quota.service';
import { ListingCommandService } from '../../listing/services/listing-command.service';
import { OrdersStateMachineService } from '../../orders-state-machine.service';
import {
  clearedOrderVideoUpdateData,
  collectOrderVideoFilenames,
  deleteOrderVideoFile,
  orderHasStoredVideos,
} from '../../../common/upload/order-video-storage.util';
import { enrichOrderUpdateForCompletion } from '../../order-lifecycle.util';
import {
  buildOrderTicketSubject,
  formatTicketMessageBody,
} from '../../../common/ticket-message.util';
import {
  isPaymentTimeoutCancelledForActiveOffer,
  isPaymentTimeoutCancelledOrder,
  prepareListingSlotForExchangeCheckout,
} from '../../exchange-listing-order.util';
import {
  assertExchangeOrderOpenForCheckout,
  EXCHANGE_ACTIVE_FULFILLMENT_ORDER_STATUSES,
  EXCHANGE_PAYMENT_PENDING_ORDER_STATUSES,
  exchangeTerminalUserMessage,
  isExchangeOrderPaymentPending,
  isExchangeOrderTerminalForUserActions,
  isExchangePaymentTimeoutCancelReason,
  isResumableExchangeCheckoutOrder,
  reconcileExchangeOfferStatusWithOrder,
} from '../../exchange-order-sync.util';
import { formatMinutesDurationFa } from '../../../common/duration-format.util';
import { OrdersSettingsService } from '../../orders-settings.service';
import { OrdersResponseEnrichmentService } from '../query/orders-response-enrichment.service';
import {
  AWAITING_SELLER_SHIPMENT_STATUSES,
  EXCHANGE_PEER_SHIP_WAIT_STATUSES,
  PURGE_COMPLETED_ORDER_VIDEOS_BATCH,
} from '../../orders.constants';
import { BUYER_CONFIRM_ELIGIBLE_STATUSES } from '../query/orders-response-enrichment.service';
`;

const checkoutBody = transformBody(
  slice(107, 1002) +
    '\n\n' +
    slice(4091, 4198),
);

const shippingBody = transformBody(slice(1004, 1132) + '\n\n' + slice(1522, 1594));

const completionBody = transformBody(
  slice(1134, 1394) +
    '\n\n' +
    slice(1428, 1450) +
    '\n\n' +
    slice(1599, 2046),
);

const schedulerBody = transformBody(
  slice(1452, 1520) +
    '\n\n' +
    slice(2047, 2659) +
    '\n\n' +
    slice(2837, 3911) +
    '\n\n' +
    slice(4051, 4089) +
    '\n\n' +
    slice(4200, 4267),
);

function checkoutClass() {
  return `${prismaImports}

@Injectable()
export class OrdersCheckoutService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly walletService: WalletService,
    private readonly feeCalculator: FeeCalculatorService,
    private readonly appSettings: AppSettingsService,
    private readonly stateMachine: OrdersStateMachineService,
    private readonly paymentsService: PaymentsService,
    private readonly notificationService: NotificationService,
    private readonly exchangeOrderNotify: ExchangeOrderNotifyService,
    private readonly orderReputation: OrderReputationService,
    private readonly exchangeService: ExchangeService,
    private readonly quotaService: QuotaService,
    private readonly listingCommand: ListingCommandService,
    private readonly settings: OrdersSettingsService,
  ) {}

${checkoutBody}
}
`;
}

function shippingClass() {
  return `${prismaImports.replace(
    "import {\n  BadRequestException",
    "import {\n  BadRequestException",
  )}
import { Inject, forwardRef } from '@nestjs/common';
import { OrdersSchedulerService } from '../scheduler/orders-scheduler.service';

@Injectable()
export class OrdersShippingService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly stateMachine: OrdersStateMachineService,
    private readonly notificationService: NotificationService,
    private readonly listingCommand: ListingCommandService,
    private readonly settings: OrdersSettingsService,
    private readonly responseEnrichment: OrdersResponseEnrichmentService,
    @Inject(forwardRef(() => OrdersSchedulerService))
    private readonly scheduler: OrdersSchedulerService,
  ) {}

${shippingBody.replace(/this\.tryCancelExpiredShippingForOrder\(/g, 'this.scheduler.tryCancelExpiredShippingForOrder(')}
}
`;
}

function completionClass() {
  return `${prismaImports}
import { OrdersSchedulerService } from '../scheduler/orders-scheduler.service';

@Injectable()
export class OrdersCompletionService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly walletService: WalletService,
    private readonly stateMachine: OrdersStateMachineService,
    private readonly notificationService: NotificationService,
    private readonly orderReputation: OrderReputationService,
    private readonly exchangeService: ExchangeService,
    private readonly quotaService: QuotaService,
    private readonly listingCommand: ListingCommandService,
    private readonly settings: OrdersSettingsService,
    private readonly responseEnrichment: OrdersResponseEnrichmentService,
    private readonly scheduler: OrdersSchedulerService,
  ) {}

${completionBody.replace(/this\.tryAutoConfirmSellerReturnReceipt\(/g, 'this.scheduler.tryAutoConfirmSellerReturnReceipt(')}
}
`;
}

function schedulerClass() {
  return `${prismaImports}

@Injectable()
export class OrdersSchedulerService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly walletService: WalletService,
    private readonly feeCalculator: FeeCalculatorService,
    private readonly notificationService: NotificationService,
    private readonly exchangeOrderNotify: ExchangeOrderNotifyService,
    private readonly orderReputation: OrderReputationService,
    private readonly exchangeService: ExchangeService,
    private readonly quotaService: QuotaService,
    private readonly listingCommand: ListingCommandService,
    private readonly settings: OrdersSettingsService,
    private readonly responseEnrichment: OrdersResponseEnrichmentService,
  ) {}

  computeBuyerConfirmDeadlineNow(): Promise<Date> {
    return this.responseEnrichment.computeBuyerConfirmDeadlineNow();
  }

  async ensureBuyerConfirmDeadline(orderId: string): Promise<void> {
    return this.responseEnrichment.ensureBuyerConfirmDeadline(orderId);
  }

  private async isBuyerConfirmDeadlineExpired(order: {
    status: OrderStatus;
    buyerConfirmDeadline: Date | null;
    disputedAt: Date | null;
    updatedAt: Date;
    createdAt: Date;
  }): Promise<boolean> {
    return this.responseEnrichment.isBuyerConfirmDeadlineExpired(order);
  }

${schedulerBody}
}
`;
}

const facade = `import { Injectable } from '@nestjs/common';
import { CreateOrderDto } from './dto/create-order.dto';
import { OrdersCheckoutService } from './services/command/orders-checkout.service';
import { OrdersShippingService } from './services/command/orders-shipping.service';
import { OrdersCompletionService } from './services/command/orders-completion.service';
import { OrdersSchedulerService } from './services/scheduler/orders-scheduler.service';

/**
 * Backward-compatible facade. Prefer injecting specialized services directly.
 */
@Injectable()
export class OrdersService {
  constructor(
    private readonly checkout: OrdersCheckoutService,
    private readonly shipping: OrdersShippingService,
    private readonly completion: OrdersCompletionService,
    private readonly scheduler: OrdersSchedulerService,
  ) {}

  handleUniversalOrder(userId: string, dto: CreateOrderDto | Record<string, unknown>) {
    return this.checkout.handleUniversalOrder(userId, dto);
  }

  updateTrackingCode(
    userId: string,
    orderId: string,
    trackingCode: string,
    videoPath?: string,
  ) {
    return this.shipping.updateTrackingCode(userId, orderId, trackingCode, videoPath);
  }

  submitReturnTrackingCode(
    userId: string,
    orderId: string,
    trackingCode: string,
    videoPath?: string,
  ) {
    return this.completion.submitReturnTrackingCode(
      userId,
      orderId,
      trackingCode,
      videoPath,
    );
  }

  confirmReturnReceipt(sellerId: string, orderId: string) {
    return this.completion.confirmReturnReceipt(sellerId, orderId);
  }

  tryAutoConfirmSellerReturnReceipt(orderId: string) {
    return this.scheduler.tryAutoConfirmSellerReturnReceipt(orderId);
  }

  autoConfirmSellerReturnReceipt() {
    return this.scheduler.autoConfirmSellerReturnReceipt();
  }

  setExchangeSellerRelistChoice(userId: string, orderId: string, publish: boolean) {
    return this.shipping.setExchangeSellerRelistChoice(userId, orderId, publish);
  }

  confirmOrder(userId: string, orderId: string) {
    return this.completion.confirmOrder(userId, orderId);
  }

  disputeOrder(userId: string, orderId: string, reason: string, videoPath?: string) {
    return this.completion.disputeOrder(userId, orderId, reason, videoPath);
  }

  computeBuyerConfirmDeadlineNow() {
    return this.scheduler.computeBuyerConfirmDeadlineNow();
  }

  ensureBuyerConfirmDeadline(orderId: string) {
    return this.scheduler.ensureBuyerConfirmDeadline(orderId);
  }

  tryAutoConfirmExpiredOrder(orderId: string) {
    return this.scheduler.tryAutoConfirmExpiredOrder(orderId);
  }

  isShippingDeadlineExpired(order: Parameters<OrdersSchedulerService['isShippingDeadlineExpired']>[0]) {
    return this.scheduler.isShippingDeadlineExpired(order);
  }

  tryCancelExpiredShippingForOrder(orderId: string) {
    return this.scheduler.tryCancelExpiredShippingForOrder(orderId);
  }

  autoCancelExpiredOrders() {
    return this.scheduler.autoCancelExpiredOrders();
  }

  autoReconcileStaleExchangeOfferStatus() {
    return this.scheduler.autoReconcileStaleExchangeOfferStatus();
  }

  autoCancelTimedOutExchangeCompletions() {
    return this.scheduler.autoCancelTimedOutExchangeCompletions();
  }

  autoConfirmOrders() {
    return this.scheduler.autoConfirmOrders();
  }

  autoReleaseExchangeReturnEscrow() {
    return this.scheduler.autoReleaseExchangeReturnEscrow();
  }

  purgeCompletedOrderVideos() {
    return this.scheduler.purgeCompletedOrderVideos();
  }
}
`;

const settingsBody = transformBody(
  slice(1395, 1426) + '\n\n' + slice(2675, 2708) + '\n\n' + slice(3913, 4050) + '\n\n' + slice(4258, 4267),
);

const settingsFile = `import { Injectable } from '@nestjs/common';
import { OrderStatus, OrderType, Prisma } from '@prisma/client';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { readPositiveIntSetting } from '../../common/system-settings/numeric-setting.util';
import {
  DEFAULT_BUYER_CONFIRM_DEADLINE_MINUTES,
  DEFAULT_EXCHANGE_NO_PAYMENT_TIMEOUT_HOURS,
  DEFAULT_EXCHANGE_NO_SHIPMENT_COMPENSATION,
  DEFAULT_EXCHANGE_PAYMENT_DEADLINE_MINUTES,
  DEFAULT_EXCHANGE_RETURN_CONFIRM_DEADLINE_MINUTES,
  DEFAULT_EXCHANGE_SECOND_PAYMENT_TIMEOUT_HOURS,
  DEFAULT_EXCHANGE_SHIPMENT_TIMEOUT_HOURS,
  DEFAULT_ORDER_VIDEO_RETENTION_DAYS,
  DEFAULT_SELLER_RETURN_CONFIRM_DEADLINE_MINUTES,
  DEFAULT_SELLER_SHIP_DEADLINE_MINUTES,
  EXCHANGE_PAYMENT_TIMEOUT_TRUST_PENALTY,
} from './orders.constants';

@Injectable()
export class OrdersSettingsService {
  constructor(private readonly prisma: PrismaService) {}

${settingsBody.replace(/this\.parsePositiveIntSetting\(/g, 'this.parsePositiveIntSetting(')}
}
`;

const constantsFile = `import { OrderStatus } from '@prisma/client';

export const DEFAULT_SELLER_SHIP_DEADLINE_MINUTES = 3 * 24 * 60;
export const DEFAULT_BUYER_CONFIRM_DEADLINE_MINUTES = 4 * 24 * 60;
export const DEFAULT_EXCHANGE_NO_SHIPMENT_COMPENSATION = 20;
export const DEFAULT_EXCHANGE_NO_PAYMENT_TIMEOUT_HOURS = 24;
export const DEFAULT_EXCHANGE_PAYMENT_DEADLINE_MINUTES = 24 * 60;
export const DEFAULT_EXCHANGE_SECOND_PAYMENT_TIMEOUT_HOURS = 48;
export const EXCHANGE_PAYMENT_TIMEOUT_TRUST_PENALTY = 15;
export const DEFAULT_EXCHANGE_SHIPMENT_TIMEOUT_HOURS = 48;
export const DEFAULT_EXCHANGE_RETURN_CONFIRM_DEADLINE_MINUTES = 48 * 60;
export const DEFAULT_SELLER_RETURN_CONFIRM_DEADLINE_MINUTES = 72 * 60;
export const DEFAULT_ORDER_VIDEO_RETENTION_DAYS = 10;
export const PURGE_COMPLETED_ORDER_VIDEOS_BATCH = 100;

export const AWAITING_SELLER_SHIPMENT_STATUSES: OrderStatus[] = [
  OrderStatus.PAID,
  OrderStatus.AWAITING_SHIPMENT_TO_HUB,
];

export const EXCHANGE_PEER_SHIP_WAIT_STATUSES: OrderStatus[] = [
  OrderStatus.SHIPPED_TO_HUB,
];
`;

const out = (rel, content) => {
  const p = path.join(root, rel);
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, content, 'utf8');
  console.log('wrote', rel, content.split('\n').length, 'lines');
};

out('src/modules/orders/orders.constants.ts', constantsFile);
out('src/modules/orders/orders-settings.service.ts', settingsFile);
out('src/modules/orders/services/command/orders-checkout.service.ts', checkoutClass());
out('src/modules/orders/services/command/orders-shipping.service.ts', shippingClass());
out('src/modules/orders/services/command/orders-completion.service.ts', completionClass());
out('src/modules/orders/services/scheduler/orders-scheduler.service.ts', schedulerClass());
out('src/modules/orders/orders.service.ts', facade);

console.log('done');
