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
import { OrdersSchedulerService } from '../scheduler/orders-scheduler.service';

@Injectable()
export class OrdersShippingService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly stateMachine: OrdersStateMachineService,
    private readonly notificationService: NotificationService,
    private readonly exchangeOrderNotify: ExchangeOrderNotifyService,
    private readonly listingCommand: ListingCommandService,
    private readonly settings: OrdersSettingsService,
    private readonly responseEnrichment: OrdersResponseEnrichmentService,
    @Inject(forwardRef(() => OrdersSchedulerService))
    private readonly scheduler: OrdersSchedulerService,
  ) {}

  async updateTrackingCode(
    userId: string,
    orderId: string,
    trackingCode: string,
    videoPath?: string,
  ) {
    if (!/^\d{24}$/.test(trackingCode)) {
      throw new BadRequestException('کد رهگیری باید دقیقاً ۲۴ رقم باشد.');
    }

    // ویدیوی بسته‌بندی برای هرگونه ارسال (فروش/معاوضه) الزامی است
    if (!videoPath) {
      throw new BadRequestException(
        'ویدیوی بسته‌بندی کالا الزامی است. لطفاً هنگام بسته‌بندی از کالا فیلم بگیرید.',
      );
    }

    const order = await this.prisma.order.findUnique({
      where: { id: orderId },
      include: { listing: true },
    });

    if (!order) throw new NotFoundException('سفارش یافت نشد');

    const isSeller = order.sellerId === userId;
    const isBuyer = order.buyerId === userId;

    if (!isSeller && !isBuyer) throw new ForbiddenException('دسترسی غیرمجاز');

    if (
      order.status === OrderStatus.CANCELLED ||
      order.status === OrderStatus.REJECTED_AT_HUB
    ) {
      throw new BadRequestException(
        'این سفارش لغو شده و امکان ثبت اطلاعات ارسال وجود ندارد.',
      );
    }

    if (await this.scheduler.isShippingDeadlineExpired(order)) {
      await this.scheduler.tryCancelExpiredShippingForOrder(orderId);
      throw new BadRequestException(
        'مهلت ارسال به پایان رسیده است؛ سفارش لغو شده و امکان ثبت اطلاعات ارسال وجود ندارد.',
      );
    }

    const updateData: Prisma.OrderUpdateInput = {};

    if (
      order.type === OrderType.EXCHANGE &&
      (!order.shippingAddress ||
        !order.sellerShippingAddress ||
        !(
          [
            OrderStatus.AWAITING_SHIPMENT_TO_HUB,
            OrderStatus.SHIPPED_TO_HUB,
          ] as OrderStatus[]
        ).includes(order.status))
    ) {
      throw new BadRequestException(
        'ارسال کالا پس از تکمیل پرداخت هر دو طرف فعال می‌شود',
      );
    }

    // منطق هوشمند: آیا کالا باید به هاب برود یا مستقیم به خریدار؟
    const needsHub =
      order.type === OrderType.EXCHANGE ||
      order.requiresVerification ||
      order.listing?.sellerRequiresVerification;

    const nextShipStatus = needsHub
      ? OrderStatus.SHIPPED_TO_HUB
      : OrderStatus.SHIPPED;
    updateData.status = nextShipStatus;
    if (nextShipStatus === OrderStatus.SHIPPED && !order.buyerConfirmDeadline) {
      updateData.buyerConfirmDeadline =
        await this.responseEnrichment.computeBuyerConfirmDeadlineNow();
    }

    // جایگذاری صحیح کد رهگیری و ویدیو بر اساس شخص ارسال‌کننده
    if (isSeller) {
      if (order.trackingCode) {
        throw new BadRequestException(
          'شما قبلاً کد رهگیری این ارسال را ثبت کرده‌اید',
        );
      }
      updateData.trackingCode = trackingCode;
      updateData.packagingVideo = videoPath;
    } else if (order.type === OrderType.EXCHANGE && isBuyer) {
      if (order.sellerTrackingCode) {
        throw new BadRequestException(
          'شما قبلاً کد رهگیری این ارسال را ثبت کرده‌اید',
        );
      }
      updateData.sellerTrackingCode = trackingCode;
      updateData.buyerPackagingVideo = videoPath;
    } else {
      throw new ForbiddenException(
        'شما مجاز به ثبت اطلاعات ارسال برای این سفارش نیستید',
      );
    }

    // در معاوضه: بعد از ثبت اولین ارسال، مهلت ارسال طرف مقابل از تنظیمات ادمین تمدید می‌شود.
    if (order.type === OrderType.EXCHANGE) {
      const sellerTrackingAfter = isSeller ? trackingCode : order.trackingCode;
      const buyerTrackingAfter = isBuyer
        ? trackingCode
        : order.sellerTrackingCode;
      const onlyOneSideShipped =
        Boolean(sellerTrackingAfter) !== Boolean(buyerTrackingAfter);
      if (onlyOneSideShipped) {
        const shipmentDeadlineMinutes =
          await this.settings.getExchangeShipmentDeadlineMinutes();
        updateData.shippingDeadline = new Date(
          Date.now() + shipmentDeadlineMinutes * 60 * 1000,
        );
      }
    }

    const updated = await this.prisma.order.update({
      where: { id: orderId },
      data: updateData,
    });

    if (order.type === OrderType.EXCHANGE) {
      await this.exchangeOrderNotify.afterShipmentUpdated(updated, userId);
    }

    return updated;
  }

  async setExchangeSellerRelistChoice(
    userId: string,
    orderId: string,
    publish: boolean,
  ) {
    return this.prisma.$transaction(async (tx) => {
      const order = await tx.order.findUnique({
        where: { id: orderId },
        include: { listing: { select: { id: true, title: true } } },
      });
      if (!order) throw new NotFoundException('سفارش یافت نشد');
      if (order.type !== OrderType.EXCHANGE) {
        throw new BadRequestException('این عملیات فقط برای معاوضه مجاز است');
      }
      if (order.sellerId !== userId) {
        throw new ForbiddenException('فقط صاحب آگهی می‌تواند این انتخاب را ثبت کند');
      }
      if (order.status !== OrderStatus.REJECTED_AT_HUB) {
        throw new BadRequestException('سفارش در وضعیت مناسب برای این انتخاب نیست');
      }
      const prev =
        (order.exchangeHubInspection as Record<string, unknown> | null) ?? {};
      if (!prev['awaitingSellerRelistChoice']) {
        throw new BadRequestException(
          'برای این سفارش انتخاب انتشار مجدد آگهی در دسترس نیست',
        );
      }
      if (prev['sellerRelistChoice']) {
        throw new BadRequestException('انتخاب شما قبلاً ثبت شده است');
      }

      const listingTitle = order.listing?.title?.trim() || 'کالا';
      const nextInspection = {
        ...prev,
        awaitingSellerRelistChoice: false,
        sellerRelistChoice: publish ? 'PUBLISH' : 'HIDE',
        sellerRelistDecidedAt: new Date().toISOString(),
      };

      if (publish) {
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
      } else {
        await this.listingCommand.rejectAfterTradeFailure(tx, {
          listingId: order.listingId,
          sellerId: order.sellerId,
          listingTitle,
          rejectionReason:
            'به درخواست شما پس از لغو معاوضه (تایید کالای شما در کارشناسی)، آگهی از انتشار خارج شد.',
          source: 'hub-inspection',
          orderId,
        });
      }

      return tx.order.update({
        where: { id: orderId },
        data: {
          exchangeHubInspection: nextInspection as Prisma.InputJsonValue,
        },
      });
    });
  }
}
