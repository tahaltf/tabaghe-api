import {
  BadRequestException,
  ForbiddenException,
  Inject,
  Injectable,
  NotFoundException,
  forwardRef,
} from '@nestjs/common';
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
import { PrismaService } from '../../../../infrastructure/prisma/prisma.service';
import { readPositiveIntSetting } from '../../../../common/system-settings/numeric-setting.util';
import { WalletService } from '../../../wallet/wallet.service';
import { FeeCalculatorService } from '../../../fees/fee-calculator.service';
import { AppSettingsService } from '../../../../shared/settings/app-settings.service';
import { PaymentsService } from '../../../payments/payments.service';
import { NotificationService } from '../../../notification/notification.service';
import { OperationalNotifyService } from '../../../notification/operational-notify.service';
import { ExchangeOrderNotifyService } from '../../../notification/exchange-order-notify.service';
import { OrderReputationService } from '../../order-reputation.service';
import { ExchangeService } from '../../../exchange/exchange.service';
import { QuotaService } from '../../../quota/quota.service';
import { ListingCommandService } from '../../../listing/services/listing-command.service';
import { OrdersStateMachineService } from '../../orders-state-machine.service';
import {
  clearedOrderVideoUpdateData,
  collectOrderVideoFilenames,
  deleteOrderVideoFile,
  orderHasStoredVideos,
} from '../../../../common/upload/order-video-storage.util';
import { enrichOrderUpdateForCompletion } from '../../order-lifecycle.util';
import {
  buildOrderTicketSubject,
  formatTicketMessageBody,
} from '../../../../common/ticket-message.util';
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
import { formatMinutesDurationFa } from '../../../../common/duration-format.util';
import { OrdersSettingsService } from '../../orders-settings.service';
import { OrdersResponseEnrichmentService } from '../query/orders-response-enrichment.service';
import {
  AWAITING_SELLER_SHIPMENT_STATUSES,
  EXCHANGE_PEER_SHIP_WAIT_STATUSES,
  PURGE_COMPLETED_ORDER_VIDEOS_BATCH,
} from '../../orders.constants';
import { BUYER_CONFIRM_ELIGIBLE_STATUSES } from '../query/orders-response-enrichment.service';
import { OrdersCompletionService } from '../command/orders-completion.service';
import {
  isExchangeAutoConfirmDue,
  isExchangeLegConfirmDeadlineExpired,
} from '../../../../common/order/exchange-hub-confirm-deadline.util';


@Injectable()
export class OrdersSchedulerService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly walletService: WalletService,
    private readonly feeCalculator: FeeCalculatorService,
    private readonly notificationService: NotificationService,
    private readonly operationalNotify: OperationalNotifyService,
    private readonly exchangeOrderNotify: ExchangeOrderNotifyService,
    private readonly orderReputation: OrderReputationService,
    private readonly exchangeService: ExchangeService,
    private readonly quotaService: QuotaService,
    private readonly listingCommand: ListingCommandService,
    private readonly stateMachine: OrdersStateMachineService,
    private readonly settings: OrdersSettingsService,
    private readonly responseEnrichment: OrdersResponseEnrichmentService,
    @Inject(forwardRef(() => OrdersCompletionService))
    private readonly completion: OrdersCompletionService,
  ) {}

  computeBuyerConfirmDeadlineNow(): Promise<Date> {
    return this.responseEnrichment.computeBuyerConfirmDeadlineNow();
  }

  async ensureBuyerConfirmDeadline(orderId: string): Promise<void> {
    return this.responseEnrichment.ensureBuyerConfirmDeadline(orderId);
  }

  private async isBuyerConfirmDeadlineExpired(
    order: Prisma.OrderGetPayload<Record<string, never>>,
  ): Promise<boolean> {
    if (order.disputedAt) return false;
    if (!BUYER_CONFIRM_ELIGIBLE_STATUSES.includes(order.status)) {
      return false;
    }
    if (order.type === OrderType.EXCHANGE) {
      return isExchangeAutoConfirmDue(order);
    }
    return this.responseEnrichment.isBuyerConfirmDeadlineExpired(order);
  }

  private async rejectListingAfterShippingTimeoutCancel(
    tx: Prisma.TransactionClient,
    params: {
      listingId: string;
      sellerId: string;
      listingTitle: string;
      rejectionReason: string;
      orderId?: string;
    },
  ): Promise<void> {
    await this.listingCommand.rejectAfterTradeFailure(tx, {
      listingId: params.listingId,
      sellerId: params.sellerId,
      listingTitle: params.listingTitle,
      rejectionReason: params.rejectionReason,
      source: 'shipping-timeout',
      orderId: params.orderId,
    });
  }

  private isExchangePaymentTimeoutCancelReason(
    reason: string | null | undefined,
  ): boolean {
    const text = String(reason ?? '').trim();
    return text.includes('مهلت پرداخت') || text.includes('اتمام مهلت پرداخت');
  }

  /** رد پیشنهادهای صف/معلق وقتی معاملهٔ پذیرفته‌شده به‌دلیل مهلت پرداخت بسته می‌شود */
  private async rejectQueuedExchangeOffersAfterPaymentTimeout(
    tx: Prisma.TransactionClient,
    listingId: string,
    exceptOfferId: string,
  ): Promise<void> {
    await tx.exchangeOffer.updateMany({
      where: {
        listingId,
        id: { not: exceptOfferId },
        status: {
          in: [ExchangeOfferStatus.PENDING, ExchangeOfferStatus.WAITLISTED],
        },
      },
      data: { status: ExchangeOfferStatus.REJECTED },
    });
  }

  /** تیکت و اعلان برای لغو فروش مستقیم به‌دلیل عدم ارسال فروشنده در مهلت */
  private async createShippingTimeoutCancelTickets(
    tx: Prisma.TransactionClient,
    params: {
      orderId: string;
      buyerId: string;
      sellerId: string;
      listingTitle: string;
      totalAmount: number;
      trustPenaltyPoints?: number;
    },
  ): Promise<void> {
    const shortId = params.orderId.slice(-6);
    const amountFa = Math.max(
      0,
      Number(params.totalAmount) || 0,
    ).toLocaleString('fa-IR');
    const penalty = params.trustPenaltyPoints ?? 15;
    const listingTitle = params.listingTitle?.trim() || 'کالا';

    const buyerTicketMessage = formatTicketMessageBody([
      `متأسفیم؛ سفارش #${shortId} برای «${listingTitle}» لغو شد.`,
      'دلیل: فروشنده در مهلت قانونی ارسال، مرسوله را ثبت نکرد.',
      `مبلغ پرداختی شما (${amountFa} تومان) به کیف پولتان در طبقه برگشت داده شد.`,
      'از صبر و شکیبایی شما سپاسگزاریم و بابت ناراحتی پیش‌آمده پوزش می‌خواهیم.',
      `طبق قوانین طبقه، ${penalty} واحد از امتیاز اعتماد فروشنده کسر شد.`,
      'در صورت نیاز می‌توانید از همین تیکت با پشتیبانی در ارتباط باشید.',
    ]);

    const sellerTicketMessage = formatTicketMessageBody([
      `سفارش #${shortId} برای «${listingTitle}» لغو شد.`,
      'دلیل: شما در مهلت قانونی ارسال، کد رهگیری یا ویدیوی بسته‌بندی را ثبت نکردید.',
      `وجه پرداختی خریدار (${amountFa} تومان) به کیف پول او برگشت داده شد؛ مبلغ بلوکه‌شده در کیف پول شما نیز آزاد شد.`,
      `به‌دلیل تأخیر در ارسال، ${penalty} واحد از امتیاز اعتماد شما کسر شد.`,
      'برای سفارش‌های بعدی لطفاً ارسال را در مهلت مقرر انجام دهید.',
    ]);

    const buyerTicket = await tx.ticket.create({
      data: {
        userId: params.buyerId,
        subject: buildOrderTicketSubject('عدم ارسال فروشنده — لغو', params.orderId),
        status: 'OPEN',
        messages: {
          create: {
            senderRole: UserRole.ADMIN,
            message: buyerTicketMessage,
          },
        },
      },
      select: { id: true },
    });

    const sellerTicket = await tx.ticket.create({
      data: {
        userId: params.sellerId,
        subject: buildOrderTicketSubject('عدم ارسال در مهلت — لغو', params.orderId),
        status: 'OPEN',
        messages: {
          create: {
            senderRole: UserRole.ADMIN,
            message: sellerTicketMessage,
          },
        },
      },
      select: { id: true },
    });

    await tx.notification.createMany({
      data: [
        {
          userId: params.buyerId,
          type: NotificationType.TICKET_REPLY,
          title: 'سفارش لغو شد — بازگشت وجه',
          message: `سفارش #${shortId} به‌دلیل عدم ارسال فروشنده لغو شد و مبلغ به کیف پول شما برگشت.`,
          meta: {
            orderId: params.orderId,
            ticketId: buyerTicket.id,
            reason: 'shipping-timeout-cancel',
            role: 'BUYER',
            audience: 'BUYER',
            phase: 'shipping_timeout_cancel',
            phaseKey: 'shipping_timeout_cancel',
          } as Prisma.InputJsonValue,
        },
        {
          userId: params.sellerId,
          type: NotificationType.TICKET_REPLY,
          title: 'سفارش لغو شد — کسر امتیاز',
          message: `سفارش #${shortId} به‌دلیل عدم ارسال در مهلت لغو شد؛ وجه به خریدار برگشت و امتیاز شما کاهش یافت.`,
          meta: {
            orderId: params.orderId,
            ticketId: sellerTicket.id,
            reason: 'shipping-timeout-cancel',
            role: 'SELLER',
            audience: 'SELLER',
            phase: 'shipping_timeout_cancel',
            phaseKey: 'shipping_timeout_cancel',
          } as Prisma.InputJsonValue,
        },
      ],
    });
  }

  /**
   * تیکت و اعلان برای لغو معاوضه به‌دلیل اتمام مهلت پرداخت.
   * scenario: neither | buyer_paid_only | seller_paid_only | both_incomplete
   */
  private async createExchangePaymentTimeoutCancelTickets(
    tx: Prisma.TransactionClient,
    params: {
      orderId: string | null;
      listingId?: string;
      buyerId: string;
      sellerId: string;
      listingTitle: string;
      scenario:
        | 'neither_paid'
        | 'buyer_paid_only'
        | 'seller_paid_only'
        | 'both_incomplete';
      buyerRefundAmount: number;
      sellerRefundAmount: number;
      offenderIds: string[];
    },
  ): Promise<{
    orderId: string | null;
    listingId?: string;
    buyerId: string;
    sellerId: string;
    listingTitle: string;
    buyerCompliant: boolean;
    sellerCompliant: boolean;
    buyerTicketId: string;
    sellerTicketId: string;
  }> {
    const shortId = params.orderId ? params.orderId.slice(-6) : '------';
    const penalty = await this.settings.getExchangePaymentTrustPenalty();
    const listingTitle = params.listingTitle?.trim() || 'کالا';
    const buyerAmountFa = Math.max(
      0,
      Number(params.buyerRefundAmount) || 0,
    ).toLocaleString('fa-IR');
    const sellerAmountFa = Math.max(
      0,
      Number(params.sellerRefundAmount) || 0,
    ).toLocaleString('fa-IR');

    const buildCompliantPartyMessage = (
      role: 'buyer' | 'seller',
      refundAmountFa: string,
    ) => {
      const lines = [
        `متأسفیم؛ معامله معاوضه${params.orderId ? ` #${shortId}` : ''} برای «${listingTitle}» لغو شد.`,
      ];
      if (params.scenario === 'neither_paid') {
        lines.push(
          'دلیل: هیچ‌یک از طرفین در مهلت مقرر پرداخت خود را تکمیل نکردند.',
        );
      } else if (params.scenario === 'both_incomplete') {
        lines.push(
          'دلیل: مهلت پرداخت به پایان رسید و معامله به‌طور کامل تسویه نشد.',
        );
      } else {
        lines.push(
          'دلیل: طرف مقابل در مهلت مقرر پرداخت خود را تکمیل نکرد.',
          'شما تعهد خود را انجام داده‌اید؛ از بابت این تجربه ناخوشایند صمیمانه پوزش می‌خواهیم.',
        );
      }
      if (Number(params.buyerRefundAmount) > 0 && role === 'buyer') {
        lines.push(
          '',
          `سهم پرداختی شما (${refundAmountFa} تومان) به کیف پولتان برگشت داده شد.`,
        );
      }
      if (Number(params.sellerRefundAmount) > 0 && role === 'seller') {
        lines.push(
          '',
          `سهم پرداختی شما (${refundAmountFa} تومان) به کیف پولتان برگشت داده شد.`,
        );
      }
      if (
        params.offenderIds.includes(
          role === 'buyer' ? params.buyerId : params.sellerId,
        )
      ) {
        lines.push(
          '',
          `طبق قوانین طبقه، ${penalty} واحد از امتیاز اعتماد شما کسر شد.`,
        );
      }
      lines.push(
        'در صورت نیاز می‌توانید از همین تیکت با پشتیبانی در ارتباط باشید.',
      );
      return formatTicketMessageBody(lines);
    };

    const buildOffenderMessage = (role: 'buyer' | 'seller') => {
      const isBuyer = role === 'buyer';
      const userId = isBuyer ? params.buyerId : params.sellerId;
      if (!params.offenderIds.includes(userId)) {
        return buildCompliantPartyMessage(
          role,
          isBuyer ? buyerAmountFa : sellerAmountFa,
        );
      }
      return formatTicketMessageBody([
        `معامله معاوضه${params.orderId ? ` #${shortId}` : ''} برای «${listingTitle}» لغو شد.`,
        'دلیل: شما در مهلت مقرر پرداخت سهم خود را تکمیل نکردید.',
        `طبق قوانین طبقه، ${penalty} واحد از امتیاز اعتماد شما کسر شد.`,
        isBuyer
          ? 'آگهی برای پذیرش پیشنهادهای دیگر در دسترس باقی می‌ماند.'
          : 'آگهی شما به‌دلیل عدم پرداخت در مهلت مقرر از انتشار خارج شد؛ برای فروش مجدد آن را ویرایش و دوباره ثبت کنید.',
        'در صورت نیاز می‌توانید از همین تیکت با پشتیبانی در ارتباط باشید.',
      ]);
    };

    const exchangePaymentSubject = params.orderId
      ? buildOrderTicketSubject('مهلت پرداخت — لغو معاوضه', params.orderId)
      : `مهلت پرداخت — لغو معاوضه · ${listingTitle}`;

    const buyerTicket = await tx.ticket.create({
      data: {
        userId: params.buyerId,
        subject: exchangePaymentSubject,
        status: 'OPEN',
        messages: {
          create: {
            senderRole: UserRole.ADMIN,
            message: buildOffenderMessage('buyer'),
          },
        },
      },
      select: { id: true },
    });

    const sellerTicket = await tx.ticket.create({
      data: {
        userId: params.sellerId,
        subject: exchangePaymentSubject,
        status: 'OPEN',
        messages: {
          create: {
            senderRole: UserRole.ADMIN,
            message: buildOffenderMessage('seller'),
          },
        },
      },
      select: { id: true },
    });

    const buyerCompliant = !params.offenderIds.includes(params.buyerId);
    const sellerCompliant = !params.offenderIds.includes(params.sellerId);

    return {
      orderId: params.orderId,
      listingId: params.listingId,
      buyerId: params.buyerId,
      sellerId: params.sellerId,
      listingTitle,
      buyerCompliant,
      sellerCompliant,
      buyerTicketId: buyerTicket.id,
      sellerTicketId: sellerTicket.id,
    };
  }

  /** تیکت و اعلان برای لغو معاوضه به‌دلیل عدم ارسال هر دو طرف در مهلت */
  private buildExchangeBothNoShipmentPartyTicketLines(params: {
    shortId: string;
    listingTitle: string;
    paidAmount: number;
    refundAmount: number;
    penaltyAmount: number;
    penaltyPercent: number;
    trustPenaltyPoints: number;
  }): string[] {
    const paidFa = Math.max(0, Number(params.paidAmount) || 0).toLocaleString(
      'fa-IR',
    );
    const refundFa = Math.max(
      0,
      Number(params.refundAmount) || 0,
    ).toLocaleString('fa-IR');
    const penaltyFa = Math.max(
      0,
      Number(params.penaltyAmount) || 0,
    ).toLocaleString('fa-IR');
    const lines = [
      `متأسفیم؛ معامله معاوضه #${params.shortId} برای «${params.listingTitle}» لغو شد.`,
      'دلیل: هیچ‌یک از طرفین در مهلت قانونی ارسال، مرسوله را ثبت نکردند.',
      `مبلغ پرداختی شما: ${paidFa} تومان.`,
    ];
    if (params.penaltyAmount > 0) {
      lines.push(
        `جریمه کارشناسی (${params.penaltyPercent}٪ طبق تنظیمات پلتفرم): ${penaltyFa} تومان.`,
        `مبلغ واریزشده به کیف پول شما: ${refundFa} تومان (پس از کسر جریمه).`,
      );
    } else if (params.refundAmount > 0) {
      lines.push(`مبلغ واریزشده به کیف پول شما: ${refundFa} تومان.`);
    } else {
      lines.push('مبلغی برای بازگشت به کیف پول شما ثبت نشد.');
    }
    lines.push(
      'از صبر و شکیبایی شما سپاسگزاریم و بابت ناراحتی پیش‌آمده پوزش می‌خواهیم.',
      `طبق قوانین طبقه، ${params.trustPenaltyPoints} واحد از امتیاز اعتماد شما کسر شد.`,
      'در صورت نیاز می‌توانید از همین تیکت با پشتیبانی در ارتباط باشید.',
    );
    return lines;
  }

  private async createExchangeBothNoShipmentCancelTickets(
    tx: Prisma.TransactionClient,
    params: {
      orderId: string;
      listingId: string;
      buyerId: string;
      sellerId: string;
      listingTitle: string;
      buyerPaidAmount: number;
      sellerPaidAmount: number;
      buyerRefundAmount: number;
      sellerRefundAmount: number;
      inspectionPenaltyPercent: number;
      inspectionPenaltyPerParty: number;
      trustPenaltyPoints?: number;
    },
  ): Promise<{
    orderId: string;
    listingId: string;
    buyerId: string;
    sellerId: string;
    listingTitle: string;
    shortId: string;
    penaltyPerParty: number;
    penaltyPct: number;
    buyerRefundAmount: number;
    sellerRefundAmount: number;
    buyerTicketId: string;
    sellerTicketId: string;
  }> {
    const shortId = params.orderId.slice(-6);
    const penalty = params.trustPenaltyPoints ?? 15;
    const listingTitle = params.listingTitle?.trim() || 'کالا';
    const penaltyPct = Math.max(
      0,
      Number(params.inspectionPenaltyPercent) || 0,
    );
    const penaltyPerParty = Math.max(
      0,
      Number(params.inspectionPenaltyPerParty) || 0,
    );

    const buyerTicketMessage = formatTicketMessageBody(
      this.buildExchangeBothNoShipmentPartyTicketLines({
        shortId,
        listingTitle,
        paidAmount: params.buyerPaidAmount,
        refundAmount: params.buyerRefundAmount,
        penaltyAmount: penaltyPerParty,
        penaltyPercent: penaltyPct,
        trustPenaltyPoints: penalty,
      }),
    );

    const sellerTicketMessage = formatTicketMessageBody(
      this.buildExchangeBothNoShipmentPartyTicketLines({
        shortId,
        listingTitle,
        paidAmount: params.sellerPaidAmount,
        refundAmount: params.sellerRefundAmount,
        penaltyAmount: penaltyPerParty,
        penaltyPercent: penaltyPct,
        trustPenaltyPoints: penalty,
      }),
    );

    const bothNoShipSubject = buildOrderTicketSubject(
      'عدم ارسال هر دو طرف — لغو معاوضه',
      params.orderId,
    );

    const buyerTicket = await tx.ticket.create({
      data: {
        userId: params.buyerId,
        subject: bothNoShipSubject,
        status: 'OPEN',
        messages: {
          create: {
            senderRole: UserRole.ADMIN,
            message: buyerTicketMessage,
          },
        },
      },
      select: { id: true },
    });

    const sellerTicket = await tx.ticket.create({
      data: {
        userId: params.sellerId,
        subject: bothNoShipSubject,
        status: 'OPEN',
        messages: {
          create: {
            senderRole: UserRole.ADMIN,
            message: sellerTicketMessage,
          },
        },
      },
      select: { id: true },
    });

    return {
      orderId: params.orderId,
      listingId: params.listingId,
      buyerId: params.buyerId,
      sellerId: params.sellerId,
      listingTitle,
      shortId,
      penaltyPerParty,
      penaltyPct,
      buyerRefundAmount: params.buyerRefundAmount,
      sellerRefundAmount: params.sellerRefundAmount,
      buyerTicketId: buyerTicket.id,
      sellerTicketId: sellerTicket.id,
    };
  }

  /** تیکت و اعلان: یک طرف ارسال کرده، طرف مقابل در مهلت ارسال نکرده */
  private async createExchangeOneSideNoShipmentCancelTickets(
    tx: Prisma.TransactionClient,
    params: {
      orderId: string;
      listingId: string;
      buyerId: string;
      sellerId: string;
      senderId: string;
      offenderId: string;
      listingTitle: string;
      senderRefundAmount: number;
      offenderRefundAmount: number;
      compensationAmount: number;
      inspectionPenaltyPercent: number;
      trustPenaltyPoints?: number;
    },
  ): Promise<{
    orderId: string;
    listingId: string;
    buyerId: string;
    sellerId: string;
    listingTitle: string;
    buyerIsSender: boolean;
    buyerTicketId: string;
    sellerTicketId: string;
  }> {
    const shortId = params.orderId.slice(-6);
    const penalty = params.trustPenaltyPoints ?? 15;
    const listingTitle = params.listingTitle?.trim() || 'کالا';
    const senderAmountFa = Math.max(
      0,
      Number(params.senderRefundAmount) || 0,
    ).toLocaleString('fa-IR');
    const offenderAmountFa = Math.max(
      0,
      Number(params.offenderRefundAmount) || 0,
    ).toLocaleString('fa-IR');
    const compensationFa = Math.max(
      0,
      Number(params.compensationAmount) || 0,
    ).toLocaleString('fa-IR');
    const penaltyPct = params.inspectionPenaltyPercent;

    const senderMessage = formatTicketMessageBody(
      [
        `متأسفیم؛ معامله معاوضه #${shortId} برای «${listingTitle}» لغو شد.`,
        'دلیل: شما به‌موقع ارسال را ثبت کردید اما طرف مقابل در مهلت قانونی ارسال نکرد.',
        `سهم پرداختی شما (${senderAmountFa} تومان) به کیف پولتان برگشت.`,
        compensationFa !== '۰'
          ? `همچنین ${compensationFa} تومان بابت ${penaltyPct}٪ جبران از هزینه کارشناسی طرف مقابل به کیف پول شما واریز شد.`
          : '',
        'کالای شما بدون کارشناسی در صف مرجوع از هاب قرار می‌گیرد تا به آدرس شما برگردد.',
        'از صبر و شکیبایی شما سپاسگزاریم و بابت ناراحتی پیش‌آمده صمیمانه پوزش می‌خواهیم.',
        'در صورت نیاز می‌توانید از همین تیکت با پشتیبانی در ارتباط باشید.',
      ].filter((line): line is string => Boolean(line)),
    );

    const offenderMessage = formatTicketMessageBody([
      `معامله معاوضه #${shortId} برای «${listingTitle}» لغو شد.`,
      'دلیل: شما در مهلت قانونی ارسال، کد رهگیری یا ویدیوی بسته‌بندی را ثبت نکردید.',
      offenderAmountFa !== '۰'
        ? `پس از کسر ${penaltyPct}٪ جریمه از هزینه کارشناسی، ${offenderAmountFa} تومان به کیف پول شما برگشت.`
        : `طبق قوانین، ${penaltyPct}٪ از هزینه کارشناسی شما به‌عنوان جریمه کسر شد.`,
      `به‌دلیل تأخیر در ارسال، ${penalty} واحد از امتیاز اعتماد شما کسر شد.`,
      'در صورت نیاز می‌توانید از همین تیکت با پشتیبانی در ارتباط باشید.',
    ]);

    const senderSubject = buildOrderTicketSubject(
      'لغو معاوضه — بازگشت وجه و مرجوع کالا',
      params.orderId,
    );
    const offenderSubject = buildOrderTicketSubject(
      'عدم ارسال شما در مهلت — لغو معاوضه',
      params.orderId,
    );

    const buyerIsSender = params.senderId === params.buyerId;
    const buyerTicket = await tx.ticket.create({
      data: {
        userId: params.buyerId,
        subject: buyerIsSender ? senderSubject : offenderSubject,
        status: 'OPEN',
        messages: {
          create: {
            senderRole: UserRole.ADMIN,
            message: buyerIsSender ? senderMessage : offenderMessage,
          },
        },
      },
      select: { id: true },
    });

    const sellerTicket = await tx.ticket.create({
      data: {
        userId: params.sellerId,
        subject: buyerIsSender ? offenderSubject : senderSubject,
        status: 'OPEN',
        messages: {
          create: {
            senderRole: UserRole.ADMIN,
            message: buyerIsSender ? offenderMessage : senderMessage,
          },
        },
      },
      select: { id: true },
    });

    return {
      orderId: params.orderId,
      listingId: params.listingId,
      buyerId: params.buyerId,
      sellerId: params.sellerId,
      listingTitle,
      buyerIsSender,
      buyerTicketId: buyerTicket.id,
      sellerTicketId: sellerTicket.id,
    };
  }

  async tryAutoConfirmExpiredOrder(orderId: string): Promise<boolean> {
    const order = await this.prisma.order.findUnique({
      where: { id: orderId },
    });
    if (!order) return false;
    if (!(await this.isBuyerConfirmDeadlineExpired(order))) return false;
    await this.processAutoConfirmOrder(order);
    return true;
  }

  /** آیا مهلت ارسال گذشته و سفارش باید لغو/تسویه شود؟ */
  async isShippingDeadlineExpired(order: {
    status: OrderStatus;
    type: OrderType;
    shippingDeadline: Date | null;
    trackingCode: string | null;
    sellerTrackingCode: string | null;
    updatedAt: Date;
    createdAt: Date;
  }): Promise<boolean> {
    const awaitingInitialShip =
      AWAITING_SELLER_SHIPMENT_STATUSES.includes(order.status);
    const exchangePeerShipWait =
      order.type === OrderType.EXCHANGE &&
      EXCHANGE_PEER_SHIP_WAIT_STATUSES.includes(order.status);

    if (!awaitingInitialShip && !exchangePeerShipWait) {
      return false;
    }

    const deadline = await this.settings.resolveEffectiveShippingDeadline(order);
    if (!deadline) return false;
    if (deadline.getTime() > Date.now()) return false;

    if (order.type === OrderType.EXCHANGE) {
      const sellerSent = Boolean(order.trackingCode);
      const buyerSent = Boolean(order.sellerTrackingCode);
      if (sellerSent && buyerSent) return false;
      if (!sellerSent && !buyerSent) return awaitingInitialShip;
      return exchangePeerShipWait || awaitingInitialShip;
    }

    return !order.trackingCode;
  }

  private async findOrdersWithExpiredShippingDeadline() {
    const now = new Date();
    const candidates = await this.prisma.order.findMany({
      where: {
        OR: [
          {
            status: { in: AWAITING_SELLER_SHIPMENT_STATUSES },
            OR: [{ shippingDeadline: { lte: now } }, { shippingDeadline: null }],
          },
          {
            type: OrderType.EXCHANGE,
            status: OrderStatus.SHIPPED_TO_HUB,
            shippingDeadline: { lte: now },
            OR: [
              {
                trackingCode: { not: null },
                sellerTrackingCode: null,
              },
              {
                trackingCode: null,
                sellerTrackingCode: { not: null },
              },
            ],
          },
        ],
      },
      include: {
        listing: { select: { title: true } },
      },
    });

    const expired: typeof candidates = [];
    for (const order of candidates) {
      if (await this.isShippingDeadlineExpired(order)) {
        expired.push(order);
      }
    }
    return expired;
  }

  /**
   * لغو یک سفارش منقضی‌شده (بازگشت وجه، تیکت، امتیاز). در صورت عدم انقضا false برمی‌گرداند.
   */
  async tryCancelExpiredShippingForOrder(orderId: string): Promise<boolean> {
    const order = await this.prisma.order.findUnique({
      where: { id: orderId },
      include: { listing: { select: { title: true } } },
    });
    if (!order) return false;
    if (!(await this.isShippingDeadlineExpired(order))) return false;
    await this.cancelExpiredShippingOrder(order);
    return true;
  }

  private async cancelExpiredShippingOrder(
    order: Prisma.OrderGetPayload<{
      include: { listing: { select: { title: true } } };
    }>,
  ): Promise<void> {
    const exchangeNoShipmentCompensationPercent =
      await this.settings.getExchangeNoShipmentCompensation();
    const deferred = await this.prisma.$transaction(async (tx) =>
      this.cancelExpiredShippingOrderInTx(
        tx,
        order,
        exchangeNoShipmentCompensationPercent,
      ),
    );
    if (deferred?.kind === 'both_no_shipment') {
      await this.operationalNotify
        .notifyExchangeBothNoShipmentCancel(deferred.params)
        .catch(() => undefined);
    } else if (deferred?.kind === 'one_side') {
      await this.operationalNotify
        .notifyExchangeOneSideNoShipmentCancel(deferred.params)
        .catch(() => undefined);
    }
  }

  private async cancelExpiredShippingOrderInTx(
    tx: Prisma.TransactionClient,
    order: Prisma.OrderGetPayload<{
      include: { listing: { select: { title: true } } };
    }>,
    exchangeNoShipmentCompensationPercent: number,
  ): Promise<
    | {
        kind: 'both_no_shipment';
        params: Parameters<
          OperationalNotifyService['notifyExchangeBothNoShipmentCancel']
        >[0];
      }
    | {
        kind: 'one_side';
        params: Parameters<
          OperationalNotifyService['notifyExchangeOneSideNoShipmentCancel']
        >[0];
      }
    | null
  > {
    const current = await tx.order.findUnique({
      where: { id: order.id },
      select: { status: true },
    });
    const statusAllowsCancel =
      current &&
      (AWAITING_SELLER_SHIPMENT_STATUSES.includes(
        current.status,
      ) ||
        (order.type === OrderType.EXCHANGE &&
          current.status === OrderStatus.SHIPPED_TO_HUB));
    if (!statusAllowsCancel) {
      return null;
    }

    const sellerSent = Boolean(order.trackingCode);
    const buyerSentForExchange =
      order.type === OrderType.EXCHANGE && Boolean(order.sellerTrackingCode);
    const exchangeOnlyOneSent =
      order.type === OrderType.EXCHANGE && sellerSent !== buyerSentForExchange;
    const exchangeShipDeadlineLabel =
      order.type === OrderType.EXCHANGE
        ? formatMinutesDurationFa(
            await this.settings.getExchangeShipmentDeadlineMinutes(),
          )
        : null;

    let oneSideRefundSummary: {
      senderRefund: number;
      offenderRefund: number;
      compensation: number;
    } | null = null;
    let bothNoShipmentRefundSummary: {
      buyerPaid: number;
      sellerPaid: number;
      buyerRefund: number;
      sellerRefund: number;
      penaltyPerParty: number;
      penaltyPercent: number;
    } | null = null;

    if (order.type === OrderType.EXCHANGE && exchangeOnlyOneSent) {
      const senderId = sellerSent ? order.sellerId : order.buyerId;
      const offenderId = sellerSent ? order.buyerId : order.sellerId;
      const verificationFee = Number(order.verificationFee || 0);
      oneSideRefundSummary =
        await this.walletService.refundExchangeOneSideNoShipmentOnCancel(tx, {
          orderId: order.id,
          listingId: order.listingId,
          buyerId: order.buyerId,
          sellerId: order.sellerId,
          senderId,
          offenderId,
          verificationFee,
          inspectionPenaltyPercent: exchangeNoShipmentCompensationPercent,
        });
    } else if (order.type === OrderType.EXCHANGE) {
      // هر دو طرف پرداخت کرده‌اند ولی هیچ‌کدام ارسال نکرده — جریمهٔ درصدی کارشناسی اعمال نمی‌شود
      bothNoShipmentRefundSummary =
        await this.walletService.refundExchangeBothNoShipmentOnCancel(tx, {
          orderId: order.id,
          listingId: order.listingId,
          buyerId: order.buyerId,
          sellerId: order.sellerId,
          verificationFee: Number(order.verificationFee || 0),
          inspectionPenaltyPercent: 0,
        });
    } else {
      const cancelReason = 'عدم ارسال فروشنده در مهلت مقرر؛ معامله لغو شد';
      await this.walletService.refundDirectOrderEscrowOnCancel(tx, {
        orderId: order.id,
        listingId: order.listingId,
        buyerId: order.buyerId,
        sellerId: order.sellerId,
        totalAmount: Number(order.totalAmount || 0),
        sellerRevenue: Number(order.sellerRevenue || 0),
        cancelReason,
        refundReason: 'shipping-timeout-cancel',
      });
    }

    const exchangeBothNoShipment =
      order.type === OrderType.EXCHANGE && !exchangeOnlyOneSent;
    const isDirectShippingTimeoutCancel =
      order.type !== OrderType.EXCHANGE || exchangeOnlyOneSent;

    const targetStatus =
      order.type === OrderType.EXCHANGE && exchangeOnlyOneSent
        ? OrderStatus.REJECTED_AT_HUB
        : OrderStatus.CANCELLED;
    this.stateMachine.assertTransition(
      order.status,
      targetStatus,
      'auto-cancel-expired',
    );
    const prevShipCancel = order.status;
    await tx.order.update({
      where: { id: order.id },
      data: {
        status: targetStatus,
        cancelReason:
          order.type === OrderType.EXCHANGE && exchangeOnlyOneSent
            ? `عدم ارسال یکی از طرفین در مهلت ${exchangeShipDeadlineLabel ?? 'مقرر'} پس از ارسال طرف مقابل؛ مرجوعی کالای ارسال‌شده الزامی است`
            : exchangeBothNoShipment
              ? `عدم ارسال هر دو طرف در مهلت ${exchangeShipDeadlineLabel ?? 'مقرر'}؛ معامله معاوضه لغو شد`
              : 'عدم ارسال فروشنده در مهلت مقرر؛ معامله لغو شد',
        ...(order.type === OrderType.EXCHANGE && exchangeOnlyOneSent
          ? {
              exchangeHubInspection: {
                ...(order.exchangeHubInspection as Record<
                  string,
                  unknown
                > | null),
                resolution: 'RETURN_BOTH_TO_SENDERS',
                singleSideNoShipmentTimeout: true,
                skipInspection: true,
                returnOnlyLeg: sellerSent ? 'SELLER' : 'BUYER',
                returnSenderUserId: sellerSent ? order.sellerId : order.buyerId,
                awaitingReturnConfirmations: false,
                refundsReleasedAt: new Date().toISOString(),
              } as Prisma.InputJsonValue,
            }
          : {}),
      },
    });
    const failurePenalizeUserIds: string[] =
      order.type === OrderType.EXCHANGE && exchangeOnlyOneSent
        ? [sellerSent ? order.buyerId : order.sellerId]
        : exchangeBothNoShipment
          ? [order.buyerId, order.sellerId]
          : [order.sellerId];
    await this.orderReputation.recordTerminalOutcome(
      tx,
      {
        id: order.id,
        buyerId: order.buyerId,
        sellerId: order.sellerId,
        tradeReputationAt: order.tradeReputationAt,
      },
      prevShipCancel,
      'FAILURE',
      { failurePenalizeUserIds },
    );
    if (exchangeBothNoShipment) {
      await this.rejectListingAfterShippingTimeoutCancel(tx, {
        listingId: order.listingId,
        sellerId: order.sellerId,
        listingTitle: order.listing?.title ?? 'کالا',
        rejectionReason:
          'معامله معاوضه به‌دلیل عدم ارسال هر دو طرف در مهلت مقرر لغو شد. آگهی از انتشار خارج شد؛ برای فروش مجدد آن را ویرایش و دوباره ثبت کنید.',
        orderId: order.id,
      });
    } else if (order.type === OrderType.EXCHANGE && exchangeOnlyOneSent) {
      const offenderId = sellerSent ? order.buyerId : order.sellerId;
      if (offenderId === order.sellerId) {
        await this.rejectListingAfterShippingTimeoutCancel(tx, {
          listingId: order.listingId,
          sellerId: order.sellerId,
          listingTitle: order.listing?.title ?? 'کالا',
          rejectionReason:
            'معامله به‌دلیل عدم ارسال فروشنده در مهلت مقرر لغو شد. آگهی از انتشار خارج شد؛ برای فروش مجدد آن را ویرایش و دوباره ثبت کنید.',
          orderId: order.id,
        });
      } else {
        await tx.listing.update({
          where: { id: order.listingId },
          data: { status: ListingStatus.APPROVED },
        });
        if (order.exchangeOfferId) {
          await tx.exchangeOffer.updateMany({
            where: {
              listingId: order.listingId,
              status: ExchangeOfferStatus.WAITLISTED,
            },
            data: { status: ExchangeOfferStatus.PENDING },
          });
        }
      }
    } else if (order.type !== OrderType.EXCHANGE) {
      await this.rejectListingAfterShippingTimeoutCancel(tx, {
        listingId: order.listingId,
        sellerId: order.sellerId,
        listingTitle: order.listing?.title ?? 'کالا',
        rejectionReason:
          'معامله به‌دلیل عدم ارسال فروشنده در مهلت مقرر لغو شد. آگهی از انتشار خارج شد؛ برای فروش مجدد آن را ویرایش و دوباره ثبت کنید.',
        orderId: order.id,
      });
    }

    if (exchangeBothNoShipment && targetStatus === OrderStatus.CANCELLED) {
      const refundSummary = bothNoShipmentRefundSummary ?? {
        buyerPaid: 0,
        sellerPaid: 0,
        buyerRefund: 0,
        sellerRefund: 0,
        penaltyPerParty: 0,
        penaltyPercent: exchangeNoShipmentCompensationPercent,
      };
      const bothNotify = await this.createExchangeBothNoShipmentCancelTickets(
        tx,
        {
          orderId: order.id,
          listingId: order.listingId,
          buyerId: order.buyerId,
          sellerId: order.sellerId,
          listingTitle: order.listing?.title ?? 'کالا',
          buyerPaidAmount: refundSummary.buyerPaid,
          sellerPaidAmount: refundSummary.sellerPaid,
          buyerRefundAmount: refundSummary.buyerRefund,
          sellerRefundAmount: refundSummary.sellerRefund,
          inspectionPenaltyPercent: refundSummary.penaltyPercent,
          inspectionPenaltyPerParty: refundSummary.penaltyPerParty,
          trustPenaltyPoints: 15,
        },
      );
      return { kind: 'both_no_shipment', params: bothNotify };
    }
    if (
      order.type === OrderType.EXCHANGE &&
      exchangeOnlyOneSent &&
      oneSideRefundSummary
    ) {
      const senderId = sellerSent ? order.sellerId : order.buyerId;
      const offenderId = sellerSent ? order.buyerId : order.sellerId;
      const oneSideNotify =
        await this.createExchangeOneSideNoShipmentCancelTickets(tx, {
          orderId: order.id,
          listingId: order.listingId,
          buyerId: order.buyerId,
          sellerId: order.sellerId,
          senderId,
          offenderId,
          listingTitle: order.listing?.title ?? 'کالا',
          senderRefundAmount: oneSideRefundSummary.senderRefund,
          offenderRefundAmount: oneSideRefundSummary.offenderRefund,
          compensationAmount: oneSideRefundSummary.compensation,
          inspectionPenaltyPercent: exchangeNoShipmentCompensationPercent,
          trustPenaltyPoints: 15,
        });
      return { kind: 'one_side', params: oneSideNotify };
    }
    if (
      isDirectShippingTimeoutCancel &&
      targetStatus === OrderStatus.CANCELLED
    ) {
      await this.createShippingTimeoutCancelTickets(tx, {
        orderId: order.id,
        buyerId: order.buyerId,
        sellerId: order.sellerId,
        listingTitle: order.listing?.title ?? 'کالا',
        totalAmount: Number(order.totalAmount || 0),
        trustPenaltyPoints: 15,
      });
    }
    return null;
  }

  @Cron(CronExpression.EVERY_MINUTE)
  async autoCancelExpiredOrders() {
    const expiredOrders = await this.findOrdersWithExpiredShippingDeadline();
    for (const order of expiredOrders) {
      try {
        await this.cancelExpiredShippingOrder(order);
      } catch (error) {
        console.error(`Error auto-canceling order ${order.id}:`, error);
      }
    }
  }

  /** پیشنهاد CANCELLED با سفارش فعال (دادهٔ قدیمی) را با وضعیت سفارش هم‌راستا می‌کند */
  @Cron(CronExpression.EVERY_5_MINUTES)
  async autoReconcileStaleExchangeOfferStatus() {
    const activeOrders = await this.prisma.order.findMany({
      where: {
        type: OrderType.EXCHANGE,
        exchangeOfferId: { not: null },
        status: {
          in: [
            ...EXCHANGE_ACTIVE_FULFILLMENT_ORDER_STATUSES,
            ...EXCHANGE_PAYMENT_PENDING_ORDER_STATUSES,
          ],
        },
      },
      select: { exchangeOfferId: true },
      take: 100,
    });

    for (const row of activeOrders) {
      if (!row.exchangeOfferId) continue;
      try {
        await this.prisma.$transaction((tx) =>
          reconcileExchangeOfferStatusWithOrder(tx, row.exchangeOfferId!),
        );
      } catch (error) {
        console.error(
          `Error reconciling exchange offer ${row.exchangeOfferId}:`,
          error,
        );
      }
    }
  }

  @Cron(CronExpression.EVERY_MINUTE)
  async autoCancelTimedOutExchangeCompletions() {
    const paymentDeadlineMinutes =
      await this.settings.getExchangePaymentDeadlineMinutes();
    const acceptanceCutoff = new Date(
      Date.now() - paymentDeadlineMinutes * 60 * 1000,
    );
    const timedOutAcceptedOffers = await this.prisma.exchangeOffer.findMany({
      where: {
        status: ExchangeOfferStatus.ACCEPTED,
        updatedAt: { lte: acceptanceCutoff },
      },
      include: {
        listing: {
          select: { id: true, title: true, status: true, authorId: true },
        },
      },
    });

    for (const offer of timedOutAcceptedOffers) {
      try {
        const deferred = await this.prisma.$transaction(async (tx) =>
          this.processExchangePaymentTimeoutInTx(tx, offer),
        );
        if (deferred && typeof deferred === 'object') {
          if (deferred.waitlistRestore) {
            await this.operationalNotify
              .notifyExchangeWaitlistRestored(deferred.waitlistRestore)
              .catch(() => undefined);
          }
          if (deferred.paymentCancel) {
            await this.operationalNotify
              .notifyExchangePaymentTimeoutCancel(deferred.paymentCancel)
              .catch(() => undefined);
          }
        }
      } catch (error) {
        console.error(
          `Error auto-canceling exchange timeout for offer ${offer.id}:`,
          error,
        );
      }
    }
  }

  private async processExchangePaymentTimeoutInTx(
    tx: Prisma.TransactionClient,
    offer: {
      id: string;
      listingId: string;
      isPayerMe: boolean;
      extraPayment: unknown;
      offererId: string;
      listing: { id: string; title: string | null; authorId: string } | null;
    },
  ): Promise<{
    waitlistRestore?: Parameters<
      OperationalNotifyService['notifyExchangeWaitlistRestored']
    >[0];
    paymentCancel?: Parameters<
      OperationalNotifyService['notifyExchangePaymentTimeoutCancel']
    >[0];
  } | void> {
    const linkedOrder = await tx.order.findFirst({
      where: { exchangeOfferId: offer.id },
      select: {
        id: true,
        status: true,
        buyerId: true,
        sellerId: true,
        tradeReputationAt: true,
        cancelReason: true,
        verificationFee: true,
        totalAmount: true,
        shippingAddress: true,
        sellerShippingAddress: true,
        exchangeHubInspection: true,
      },
    });

    if (linkedOrder && !isExchangeOrderPaymentPending(linkedOrder.status)) {
      if (linkedOrder.status !== OrderStatus.CANCELLED) {
        await reconcileExchangeOfferStatusWithOrder(tx, offer.id);
        return;
      }
      const acceptedStillOpen = await tx.exchangeOffer.findUnique({
        where: { id: offer.id },
        select: { status: true },
      });
      if (acceptedStillOpen?.status === ExchangeOfferStatus.ACCEPTED) {
        await tx.exchangeOffer.update({
          where: { id: offer.id },
          data: { status: ExchangeOfferStatus.CANCELLED },
        });
      }
      if (linkedOrder.status === OrderStatus.CANCELLED) {
        await this.rejectQueuedExchangeOffersAfterPaymentTimeout(
          tx,
          offer.listingId,
          offer.id,
        );
        if (
          !linkedOrder.tradeReputationAt &&
          isExchangePaymentTimeoutCancelReason(linkedOrder.cancelReason)
        ) {
          await this.orderReputation.recordTerminalOutcome(
            tx,
            {
              id: linkedOrder.id,
              buyerId: linkedOrder.buyerId,
              sellerId: linkedOrder.sellerId,
              tradeReputationAt: linkedOrder.tradeReputationAt,
            },
            OrderStatus.AWAITING_PAYMENT,
            'FAILURE',
            {
              failurePenalizeUserIds: [
                linkedOrder.buyerId,
                linkedOrder.sellerId,
              ],
              ignoreEarlyAbort: true,
            },
          );
        }
      }
      return;
    }

    const listingTitle = offer.listing?.title ?? 'کالا';
    const sellerId = offer.listing?.authorId;
    if (!sellerId) return;

    const verificationFee = Number(linkedOrder?.verificationFee || 0);
    const extra = Number(offer.extraPayment || 0);
    const buyerShare = verificationFee + (offer.isPayerMe ? extra : 0);
    const sellerShare = verificationFee + (!offer.isPayerMe ? extra : 0);
    const expectedTotal = buyerShare + sellerShare;
    const currentTotal = Number(linkedOrder?.totalAmount || 0);
    const offererId = offer.offererId;

    let buyerPaidAmount = 0;
    let sellerPaidAmount = 0;
    if (linkedOrder) {
      buyerPaidAmount =
        await this.walletService.resolveExchangeParticipantPaidAmount(tx, {
          participantUserId: linkedOrder.buyerId,
          orderId: linkedOrder.id,
          listingId: offer.listingId,
        });
      sellerPaidAmount =
        await this.walletService.resolveExchangeParticipantPaidAmount(tx, {
          participantUserId: linkedOrder.sellerId,
          orderId: linkedOrder.id,
          listingId: offer.listingId,
        });
    }

    const buyerPaidFully =
      currentTotal >= buyerShare &&
      Boolean(linkedOrder?.shippingAddress) &&
      buyerPaidAmount >= buyerShare;
    const sellerPaidFully =
      currentTotal >= expectedTotal &&
      Boolean(linkedOrder?.sellerShippingAddress) &&
      sellerPaidAmount >= sellerShare;

    if (buyerPaidFully && sellerPaidFully) {
      return;
    }

    type PaymentTimeoutScenario =
      | 'neither_paid'
      | 'buyer_paid_only'
      | 'seller_paid_only'
      | 'both_incomplete';

    let scenario: PaymentTimeoutScenario;
    let offenderIds: string[] = [];
    let rejectListing = false;
    let restoreWaitlisted = false;
    let waitlistRestore:
      | Parameters<OperationalNotifyService['notifyExchangeWaitlistRestored']>[0]
      | undefined;

    if (buyerPaidAmount <= 0 && sellerPaidAmount <= 0) {
      scenario = 'neither_paid';
      offenderIds = linkedOrder
        ? [linkedOrder.buyerId, linkedOrder.sellerId]
        : [offererId, sellerId];
      rejectListing = true;
    } else if (buyerPaidAmount > 0 && sellerPaidAmount <= 0) {
      scenario = 'buyer_paid_only';
      offenderIds = [linkedOrder?.sellerId ?? sellerId];
      rejectListing = true;
    } else if (sellerPaidAmount > 0 && buyerPaidAmount <= 0) {
      scenario = 'seller_paid_only';
      offenderIds = [linkedOrder?.buyerId ?? offererId];
      restoreWaitlisted = true;
    } else {
      scenario = 'both_incomplete';
      if (!buyerPaidFully) {
        offenderIds.push(linkedOrder!.buyerId);
      }
      if (!sellerPaidFully) {
        offenderIds.push(linkedOrder!.sellerId);
      }
      offenderIds = [...new Set(offenderIds)];
      rejectListing = offenderIds.includes(linkedOrder!.sellerId);
      restoreWaitlisted =
        offenderIds.length === 1 && offenderIds[0] === linkedOrder!.buyerId;
    }

    const penalty = await this.settings.getExchangePaymentTrustPenalty(tx);
    if (offenderIds.length > 0) {
      await this.orderReputation.applyTrustPointsPenalty(
        tx,
        offenderIds,
        penalty,
        {
          orderId: linkedOrder?.id,
          reason: 'جریمه تأخیر یا عدم پرداخت معاوضه',
          source: 'exchange_payment_timeout',
        },
      );
    }

    let buyerRefund = 0;
    let sellerRefund = 0;
    if (linkedOrder) {
      const refunds =
        await this.walletService.refundExchangePaymentTimeoutOnCancel(tx, {
          orderId: linkedOrder.id,
          listingId: offer.listingId,
          buyerId: linkedOrder.buyerId,
          sellerId: linkedOrder.sellerId,
          refundBuyer: buyerPaidAmount > 0,
          refundSeller: sellerPaidAmount > 0,
          buyerMaxRefund: buyerShare,
          sellerMaxRefund: sellerShare,
        });
      buyerRefund = refunds.buyerRefund;
      sellerRefund = refunds.sellerRefund;

      const prevExchangePayTimeout = linkedOrder.status;
      const cancelReason =
        scenario === 'neither_paid'
          ? 'اتمام مهلت پرداخت پس از پذیرش معاوضه؛ هیچ‌یک از طرفین پرداخت را تکمیل نکردند'
          : scenario === 'buyer_paid_only'
            ? 'اتمام مهلت پرداخت؛ فروشنده (صاحب آگهی) سهم خود را پرداخت نکرد'
            : scenario === 'seller_paid_only'
              ? 'اتمام مهلت پرداخت؛ پیشنهاددهنده سهم خود را پرداخت نکرد'
              : 'اتمام مهلت پرداخت؛ معامله به‌طور کامل تسویه نشد';

      const prevHub =
        (linkedOrder.exchangeHubInspection as Record<string, unknown> | null) ??
        {};
      await tx.order.update({
        where: { id: linkedOrder.id },
        data: {
          status: OrderStatus.CANCELLED,
          cancelReason,
          exchangeHubInspection: {
            ...(typeof prevHub === 'object' && prevHub !== null ? prevHub : {}),
            paymentTimeout: true,
          } as Prisma.InputJsonValue,
        },
      });
      await this.orderReputation.recordTerminalOutcome(
        tx,
        {
          id: linkedOrder.id,
          buyerId: linkedOrder.buyerId,
          sellerId: linkedOrder.sellerId,
          tradeReputationAt: linkedOrder.tradeReputationAt,
        },
        prevExchangePayTimeout,
        'FAILURE',
        offenderIds.length
          ? { failurePenalizeUserIds: offenderIds, ignoreEarlyAbort: true }
          : undefined,
      );
    }

    await tx.exchangeOffer.update({
      where: { id: offer.id },
      data: { status: ExchangeOfferStatus.CANCELLED },
    });

    if (rejectListing) {
      await this.rejectQueuedExchangeOffersAfterPaymentTimeout(
        tx,
        offer.listingId,
        offer.id,
      );
      await this.rejectListingAfterShippingTimeoutCancel(tx, {
        listingId: offer.listingId,
        sellerId,
        listingTitle,
        rejectionReason:
          scenario === 'neither_paid'
            ? 'معامله معاوضه به‌دلیل عدم پرداخت هر دو طرف در مهلت مقرر لغو شد. آگهی از انتشار خارج شد؛ برای فروش مجدد آن را ویرایش و دوباره ثبت کنید.'
            : 'معامله معاوضه به‌دلیل عدم پرداخت فروشنده در مهلت مقرر لغو شد. آگهی از انتشار خارج شد؛ برای فروش مجدد آن را ویرایش و دوباره ثبت کنید.',
        orderId: linkedOrder?.id,
      });
    } else if (restoreWaitlisted) {
      await tx.listing.update({
        where: { id: offer.listingId },
        data: { status: ListingStatus.APPROVED },
      });

      await tx.exchangeOffer.updateMany({
        where: {
          listingId: offer.listingId,
          status: ExchangeOfferStatus.WAITLISTED,
        },
        data: { status: ExchangeOfferStatus.PENDING },
      });

      const waitlistedOfferers = await tx.exchangeOffer.findMany({
        where: {
          listingId: offer.listingId,
          status: ExchangeOfferStatus.PENDING,
          id: { not: offer.id },
        },
        select: { offererId: true },
      });
      const waitlistedUserIds = [
        ...new Set(waitlistedOfferers.map((r) => r.offererId)),
      ];
      if (waitlistedUserIds.length > 0) {
        waitlistRestore = {
          listingId: offer.listingId,
          listingTitle,
          userIds: waitlistedUserIds,
        };
      }
    } else {
      await tx.listing.update({
        where: { id: offer.listingId },
        data: { status: ListingStatus.APPROVED },
      });
    }

    const ticketBuyerId = linkedOrder?.buyerId ?? offererId;
    const ticketSellerId = linkedOrder?.sellerId ?? sellerId;
    const paymentCancel = await this.createExchangePaymentTimeoutCancelTickets(
      tx,
      {
        orderId: linkedOrder?.id ?? null,
        listingId: offer.listingId,
        buyerId: ticketBuyerId,
        sellerId: ticketSellerId,
        listingTitle,
        scenario,
        buyerRefundAmount: buyerRefund,
        sellerRefundAmount: sellerRefund,
        offenderIds,
      },
    );

    return {
      ...(waitlistRestore ? { waitlistRestore } : {}),
      paymentCancel,
    };
  }

  @Cron(CronExpression.EVERY_MINUTE)
  async autoConfirmOrders() {
    const now = new Date();
    const buyerConfirmDeadlineMinutes =
      await this.settings.getBuyerConfirmDeadlineMinutes();
    const legacyThreshold = new Date(
      Date.now() - buyerConfirmDeadlineMinutes * 60 * 1000,
    );
    const pendingOrders = await this.prisma.order.findMany({
      where: {
        status: { in: BUYER_CONFIRM_ELIGIBLE_STATUSES },
        disputedAt: null,
        OR: [
          { buyerConfirmDeadline: { lte: now } },
          {
            buyerConfirmDeadline: null,
            updatedAt: { lte: legacyThreshold },
          },
        ],
      },
    });

    for (const order of pendingOrders) {
      try {
        if (!(await this.isBuyerConfirmDeadlineExpired(order))) continue;
        await this.processAutoConfirmOrder(order);
        console.log(`Auto-confirmed order ${order.id}`);
      } catch (error) {
        console.error(`Error auto-confirming order ${order.id}:`, error);
      }
    }
  }

  private async processAutoConfirmOrder(
    order: Prisma.OrderGetPayload<Record<string, never>>,
  ): Promise<void> {
    if (order.type === OrderType.EXCHANGE) {
      await this.processExchangeAutoConfirm(order);
      return;
    }

    await this.completion.confirmOrder(order.buyerId, order.id);
  }

  /** معاوضه: فقط طرفی که مرسوله‌اش از هاب ارسال شده و مهلتش گذشته — نه کل معامله یک‌جا */
  private async processExchangeAutoConfirm(
    order: Prisma.OrderGetPayload<Record<string, never>>,
  ): Promise<void> {
    if (
      order.status === OrderStatus.COMPLETED ||
      order.status === OrderStatus.CANCELLED ||
      order.disputedAt
    ) {
      return;
    }
    if (!BUYER_CONFIRM_ELIGIBLE_STATUSES.includes(order.status)) {
      return;
    }

    const inspection = (order.exchangeHubInspection ??
      null) as Record<string, unknown> | null;
    const fallback = order.buyerConfirmDeadline;

    const buyerDue = isExchangeLegConfirmDeadlineExpired({
      hubTrackingCode: order.hubToBuyerTrackingCode,
      alreadyConfirmed: Boolean(order.buyerConfirmedDelivery),
      inspection,
      leg: 'BUYER',
      fallbackDeadline: fallback,
    });
    const sellerDue = isExchangeLegConfirmDeadlineExpired({
      hubTrackingCode: order.hubToSellerTrackingCode,
      alreadyConfirmed: Boolean(order.sellerConfirmedDelivery),
      inspection,
      leg: 'SELLER',
      fallbackDeadline: fallback,
    });

    if (!buyerDue && !sellerDue) return;

    if (buyerDue) {
      await this.completion.confirmOrder(order.buyerId, order.id);
    }
    if (sellerDue) {
      await this.completion.confirmOrder(order.sellerId, order.id);
    }
  }

  @Cron(CronExpression.EVERY_MINUTE)
  async autoReleaseExchangeReturnEscrow() {
    const now = new Date();
    const deadlineMinutes =
      await this.settings.getExchangeReturnConfirmDeadlineMinutes();
    const orders = await this.prisma.order.findMany({
      where: {
        type: OrderType.EXCHANGE,
        status: OrderStatus.CANCELLED,
        hubToBuyerTrackingCode: { not: null },
        hubToSellerTrackingCode: { not: null },
        AND: [
          {
            exchangeHubInspection: {
              path: ['resolution'],
              equals: 'RETURN_BOTH_TO_SENDERS',
            },
          },
          {
            exchangeHubInspection: {
              path: ['awaitingReturnConfirmations'],
              equals: true,
            },
          },
          {
            exchangeHubInspection: {
              path: ['refundsReleasedAt'],
              equals: null,
            },
          },
        ],
      },
      select: {
        id: true,
        buyerId: true,
        sellerId: true,
        listingId: true,
        exchangeOfferId: true,
        verificationFee: true,
        buyerConfirmedDelivery: true,
        sellerConfirmedDelivery: true,
        exchangeHubInspection: true,
      },
    });

    for (const order of orders) {
      try {
        const released = await this.prisma.$transaction(async (tx) => {
          const locked = await tx.order.findUnique({
            where: { id: order.id },
            select: {
              id: true,
              status: true,
              type: true,
              buyerId: true,
              sellerId: true,
              listingId: true,
              exchangeOfferId: true,
              verificationFee: true,
              buyerConfirmedDelivery: true,
              sellerConfirmedDelivery: true,
              exchangeHubInspection: true,
            },
          });
          if (!locked) return null;

          const inspection =
            (locked.exchangeHubInspection as Record<string, unknown> | null) ??
            {};
          if (
            locked.type !== OrderType.EXCHANGE ||
            locked.status !== OrderStatus.CANCELLED ||
            inspection['resolution'] !== 'RETURN_BOTH_TO_SENDERS' ||
            inspection['awaitingReturnConfirmations'] !== true ||
            inspection['refundsReleasedAt']
          ) {
            return null;
          }

          const returnShipmentCompletedAtRaw =
            inspection['returnShipmentCompletedAt'];
          const returnShipmentCompletedAt =
            typeof returnShipmentCompletedAtRaw === 'string'
              ? new Date(returnShipmentCompletedAtRaw)
              : null;
          if (
            !returnShipmentCompletedAt ||
            Number.isNaN(returnShipmentCompletedAt.getTime())
          ) {
            return null;
          }
          const autoReleaseAt = new Date(
            returnShipmentCompletedAt.getTime() + deadlineMinutes * 60 * 1000,
          );
          if (autoReleaseAt > now) return null;

          const openTickets = await tx.ticket.count({
            where: {
              userId: { in: [locked.buyerId, locked.sellerId] },
              status: 'OPEN',
              subject: {
                contains: `[ORDER:${locked.id}]`,
                mode: 'insensitive',
              },
            },
          });
          if (openTickets > 0) return null;

          const exchangeOffer = locked.exchangeOfferId
            ? await tx.exchangeOffer.findUnique({
                where: { id: locked.exchangeOfferId },
                select: { extraPayment: true, isPayerMe: true },
              })
            : null;

          const verificationFee = Number(locked.verificationFee || 0);
          const extra = Number(exchangeOffer?.extraPayment || 0);
          const buyerShare =
            verificationFee + (exchangeOffer?.isPayerMe ? extra : 0);
          const sellerShare =
            verificationFee + (!exchangeOffer?.isPayerMe ? extra : 0);
          const buyerRefundable = Math.max(0, buyerShare - verificationFee);
          const sellerRefundable = Math.max(0, sellerShare - verificationFee);

          await this.walletService.refundExchangeExtraOnCancel(tx, {
            buyerId: locked.buyerId,
            sellerId: locked.sellerId,
            listingId: locked.listingId,
            orderId: locked.id,
            isPayerMe: Boolean(exchangeOffer?.isPayerMe),
            buyerRefundable,
            sellerRefundable,
          });

          const mergedInspection = {
            ...inspection,
            buyerReturnReceived: true,
            sellerReturnReceived: true,
            awaitingReturnConfirmations: false,
            refundsReleasedAt: new Date().toISOString(),
            autoReleasedByTimeout: true,
          };

          await tx.order.update({
            where: { id: locked.id },
            data: {
              buyerConfirmedDelivery: true,
              sellerConfirmedDelivery: true,
              returnConfirmedAt: new Date(),
              returnConfirmedBy: 'AUTO_TIMEOUT',
              exchangeHubInspection: mergedInspection as Prisma.InputJsonValue,
            },
          });

          return {
            orderId: locked.id,
            listingId: locked.listingId,
            buyerId: locked.buyerId,
            sellerId: locked.sellerId,
          };
        });
        if (released) {
          await this.operationalNotify
            .notifyExchangeAutoReturnEscrowReleased(released)
            .catch(() => undefined);
        }
      } catch (error) {
        console.error(
          `Error auto-releasing exchange return escrow for order ${order.id}:`,
          error,
        );
      }
    }
  }

  private async creditExchangeCompensation(
    tx: Prisma.TransactionClient,
    userId: string,
    amount: number,
    orderId: string,
    compensationPercent: number,
  ): Promise<void> {
    await tx.wallet.upsert({
      where: { userId },
      create: {
        userId,
        balanceAvailable: amount,
        balanceBlocked: 0,
      },
      update: {
        balanceAvailable: { increment: amount },
      },
    });
    await tx.walletTransaction.create({
      data: {
        wallet: { connect: { userId } },
        amount,
        type: WalletTransactionType.DEPOSIT,
        status: WalletTransactionStatus.SUCCESS,
        referenceId: orderId,
        meta: {
          kind: 'exchange-compensation',
          compensationPercent,
          description: 'پرداخت جبرانی بابت عدم ارسال طرف مقابل',
        },
      },
    });
  }

  @Cron('30 3 * * *')
  async purgeCompletedOrderVideos() {
    const retentionDays = await this.settings.getOrderVideoRetentionDays();
    const cutoff = new Date(
      Date.now() - retentionDays * 24 * 60 * 60 * 1000,
    );
    const orders = await this.prisma.order.findMany({
      where: {
        status: OrderStatus.COMPLETED,
        AND: [
          {
            OR: [
              { completedAt: { lte: cutoff } },
              { completedAt: null, updatedAt: { lte: cutoff } },
            ],
          },
          {
            OR: [
              { packagingVideo: { not: null } },
              { buyerPackagingVideo: { not: null } },
              { unboxingVideo: { not: null } },
              { sellerUnboxingVideo: { not: null } },
              { returnPackagingVideo: { not: null } },
            ],
          },
        ],
      },
      select: {
        id: true,
        packagingVideo: true,
        buyerPackagingVideo: true,
        unboxingVideo: true,
        sellerUnboxingVideo: true,
        returnPackagingVideo: true,
      },
      take: PURGE_COMPLETED_ORDER_VIDEOS_BATCH,
      orderBy: { completedAt: 'asc' },
    });

    for (const order of orders) {
      if (!orderHasStoredVideos(order)) continue;
      try {
        for (const filename of collectOrderVideoFilenames(order)) {
          deleteOrderVideoFile(filename);
        }
        await this.prisma.order.update({
          where: { id: order.id },
          data: clearedOrderVideoUpdateData(),
        });
      } catch (error) {
        console.error(
          `Error purging order videos for order ${order.id}:`,
          error,
        );
      }
    }
  }
}
