import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  ExchangeOfferStatus,
  ListingStatus,
  ListingType,
  NotificationType,
  OrderStatus,
  Prisma,
  UserRole,
  WalletTransactionStatus,
  WalletTransactionType,
} from '@prisma/client';
import { PrismaService } from '../../../../infrastructure/prisma/prisma.service';

import {
  SetExchangeHubReceiptDto,
  SetHubShippingCodesDto,
  SetParticipantShippingDto,
} from '../../dto/admin-order.dto';
import { OrderReputationService } from '../../../orders/order-reputation.service';
import { WalletService } from '../../../wallet/wallet.service';
import { OrdersService } from '../../../orders/orders.service';
import { ListingCommandService } from '../../../listing/services/listing-command.service';
import { buildOrderTicketSubject } from '../../../../common/ticket-message.util';
import {
  isExchangeAutoConfirmDue,
  isExchangeLegConfirmDeadlineExpired,
  isFirstHubShipmentForLeg,
  mergeExchangeLegConfirmDeadline,
  resolveExchangeLegConfirmDeadline,
} from '../../../../common/order/exchange-hub-confirm-deadline.util';
import { OperationalNotifyService } from '../../../notification/operational-notify.service';

@Injectable()
export class AdminOrdersHubService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly orderReputation: OrderReputationService,
    private readonly walletService: WalletService,
    private readonly ordersService: OrdersService,
    private readonly listingCommand: ListingCommandService,
    private readonly operationalNotify: OperationalNotifyService,
  ) {}

  private async dispatchHubNotifications(
    rows: Prisma.NotificationCreateManyInput[],
  ): Promise<void> {
    if (!rows.length) return;
    await this.operationalNotify.notifyMany(
      rows.map((row) => ({
        userId: row.userId,
        type: row.type,
        title: row.title,
        message: row.message,
        meta: row.meta as Record<string, unknown>,
      })),
    );
  }

  async setHubShippingCodes(id: string, dto: SetHubShippingCodesDto) {
    const existing = await this.prisma.order.findUnique({
      where: { id },
      select: {
        id: true,
        type: true,
        buyerId: true,
        sellerId: true,
        listingId: true,
        exchangeOfferId: true,
        verificationFee: true,
        status: true,
        hubToBuyerTrackingCode: true,
        hubToSellerTrackingCode: true,
        exchangeHubInspection: true,
        buyerConfirmDeadline: true,
        cancelReason: true,
        totalAmount: true,
        sellerRevenue: true,
        tradeReputationAt: true,
      },
    });
    if (!existing) throw new NotFoundException('سفارش یافت نشد');
    const inspection =
      (existing.exchangeHubInspection as Record<string, unknown> | null) ??
      null;
    const isDirectHubReturnFlow =
      (existing.type === 'DIRECT' || existing.type === 'AUCTION') &&
      existing.status === OrderStatus.REJECTED_AT_HUB;
    const isExchangeReturnFlow =
      existing.type === 'EXCHANGE' &&
      (existing.status === OrderStatus.REJECTED_AT_HUB ||
        existing.status === OrderStatus.CANCELLED) &&
      inspection?.['resolution'] === 'RETURN_BOTH_TO_SENDERS';
    const canShipNormalFlow =
      existing.status === OrderStatus.VERIFIED_AT_HUB ||
      existing.status === OrderStatus.SHIPPED_TO_BUYER;
    if (!canShipNormalFlow && !isExchangeReturnFlow && !isDirectHubReturnFlow) {
      throw new BadRequestException(
        'این سفارش در وضعیت مناسب برای ارسال از هاب نیست',
      );
    }

    if (isDirectHubReturnFlow) {
      const sellerReturnCode = (dto.hubToSellerTrackingCode ?? '').trim();
      if (sellerReturnCode.length < 3) {
        throw new BadRequestException(
          'کد رهگیری مرجوع از هاب به فروشنده الزامی است',
        );
      }
    }

    const nextBuyerTracking =
      dto.hubToBuyerTrackingCode ?? existing.hubToBuyerTrackingCode;
    const nextSellerTracking =
      existing.type === 'EXCHANGE' || isDirectHubReturnFlow
        ? (dto.hubToSellerTrackingCode ?? existing.hubToSellerTrackingCode)
        : existing.hubToSellerTrackingCode;
    const returnShipmentCompleted = isDirectHubReturnFlow
      ? Boolean(nextSellerTracking)
      : isExchangeReturnFlow
        ? Boolean(nextBuyerTracking && nextSellerTracking)
        : false;
    const mergedInspection = isExchangeReturnFlow
      ? {
          ...inspection,
          returnBuyerShipped: Boolean(nextBuyerTracking),
          returnSellerShipped: Boolean(nextSellerTracking),
          returnShipmentCompletedAt: returnShipmentCompleted
            ? (inspection?.['returnShipmentCompletedAt'] ??
              new Date().toISOString())
            : (inspection?.['returnShipmentCompletedAt'] ?? null),
        }
      : null;
    const nextStatus =
      isExchangeReturnFlow || isDirectHubReturnFlow
        ? returnShipmentCompleted
          ? OrderStatus.CANCELLED
          : OrderStatus.REJECTED_AT_HUB
        : OrderStatus.SHIPPED_TO_BUYER;

    let nextInspection: Prisma.InputJsonValue | undefined = mergedInspection
      ? (mergedInspection as Prisma.InputJsonValue)
      : undefined;
    if (
      existing.type === 'EXCHANGE' &&
      !isExchangeReturnFlow &&
      !isDirectHubReturnFlow
    ) {
      const legDeadline =
        await this.ordersService.computeBuyerConfirmDeadlineNow();
      const legDeadlineIso = legDeadline.toISOString();
      let patched =
        (nextInspection as Record<string, unknown> | undefined) ??
        (inspection as Record<string, unknown> | null) ??
        {};
      if (
        isFirstHubShipmentForLeg(
          existing.hubToBuyerTrackingCode,
          dto.hubToBuyerTrackingCode,
        )
      ) {
        patched = mergeExchangeLegConfirmDeadline(
          patched,
          'BUYER',
          legDeadlineIso,
        );
      }
      if (
        isFirstHubShipmentForLeg(
          existing.hubToSellerTrackingCode,
          dto.hubToSellerTrackingCode,
        )
      ) {
        patched = mergeExchangeLegConfirmDeadline(
          patched,
          'SELLER',
          legDeadlineIso,
        );
      }
      nextInspection = patched as Prisma.InputJsonValue;
    }

    const updated = await this.prisma.order.update({
      where: { id },
      data: {
        hubToBuyerTrackingCode: isDirectHubReturnFlow
          ? existing.hubToBuyerTrackingCode
          : dto.hubToBuyerTrackingCode,
        hubToSellerTrackingCode:
          existing.type === 'EXCHANGE' || isDirectHubReturnFlow
            ? dto.hubToSellerTrackingCode
            : undefined,
        status: nextStatus,
        ...(isDirectHubReturnFlow && returnShipmentCompleted
          ? {
              returnConfirmedAt: new Date(),
              cancelReason: [
                existing.cancelReason,
                `کد رهگیری مرجوع از هاب به فروشنده: ${nextSellerTracking}`,
                dto.note ? `توضیح: ${dto.note}` : null,
              ]
                .filter(Boolean)
                .join('\n'),
            }
          : {}),
        ...(nextInspection ? { exchangeHubInspection: nextInspection } : {}),
        ...(!isExchangeReturnFlow &&
        existing.type !== 'EXCHANGE' &&
        nextStatus === OrderStatus.SHIPPED_TO_BUYER &&
        !existing.buyerConfirmDeadline
          ? {
              buyerConfirmDeadline:
                await this.ordersService.computeBuyerConfirmDeadlineNow(),
            }
          : {}),
      },
    });

    const buyerNote =
      dto.note ??
      (existing.type === 'EXCHANGE'
        ? 'مرسوله خروجی مربوط به شما از هاب ارسال شد و کد رهگیری ثبت گردید.'
        : 'مرسوله از هاب به مقصد شما ارسال شد و کد رهگیری ثبت گردید.');
    const sellerNote =
      dto.note ??
      (existing.type === 'EXCHANGE'
        ? 'مرسوله خروجی مربوط به شما از هاب ارسال شد و کد رهگیری ثبت گردید.'
        : 'مرسوله از هاب برای خریدار ارسال شد و کد رهگیری ثبت گردید.');

    const notifications: Prisma.NotificationCreateManyInput[] = [];
    if (existing.type === 'EXCHANGE') {
      const buyerLegFirstShip = isFirstHubShipmentForLeg(
        existing.hubToBuyerTrackingCode,
        dto.hubToBuyerTrackingCode,
      );
      const sellerLegFirstShip = isFirstHubShipmentForLeg(
        existing.hubToSellerTrackingCode,
        dto.hubToSellerTrackingCode,
      );
      if (buyerLegFirstShip) {
        await this.operationalNotify.notifyExchangeHubOutboundShipped({
          orderId: id,
          buyerId: existing.buyerId,
          sellerId: existing.sellerId,
          listingId: existing.listingId,
          leg: 'TO_BUYER',
          status: nextStatus,
          trackingCode: String(dto.hubToBuyerTrackingCode ?? '').trim(),
          note: dto.note,
          isReturn: isExchangeReturnFlow,
        });
      }
      if (sellerLegFirstShip) {
        await this.operationalNotify.notifyExchangeHubOutboundShipped({
          orderId: id,
          buyerId: existing.buyerId,
          sellerId: existing.sellerId,
          listingId: existing.listingId,
          leg: 'TO_SELLER',
          status: nextStatus,
          trackingCode: String(dto.hubToSellerTrackingCode ?? '').trim(),
          note: dto.note,
          isReturn: isExchangeReturnFlow,
        });
      }
    } else if (isDirectHubReturnFlow) {
      const returnNote =
        dto.note ??
        'کالا از هاب به آدرس فروشنده مرجوع شد و کد رهگیری ثبت گردید.';
      notifications.push(
        {
          userId: existing.sellerId,
          type: NotificationType.ORDER_STATUS_CHANGED,
          title: 'مرجوعی از هاب ثبت شد',
          message: `مرسوله شما از هاب به آدرس شما مرجوع شد. ${returnNote}`,
          meta: {
            orderId: id,
            status: nextStatus,
            note: returnNote,
            audience: 'SELLER',
          } as Prisma.InputJsonValue,
        },
        {
          userId: existing.buyerId,
          type: NotificationType.ORDER_STATUS_CHANGED,
          title: 'مرجوعی از هاب و بازگشت وجه',
          message: `کالا از هاب به فروشنده مرجوع شد؛ مبلغ پرداختی به کیف پول شما بازگشت داده می‌شود. ${returnNote}`,
          meta: {
            orderId: id,
            status: nextStatus,
            note: returnNote,
            audience: 'BUYER',
          } as Prisma.InputJsonValue,
        },
      );
    } else {
      notifications.push(
        {
          userId: existing.buyerId,
          type: NotificationType.ORDER_STATUS_CHANGED,
          title: 'وضعیت سفارش تغییر کرد',
          message: `وضعیت سفارش به «ارسال به خریدار» تغییر یافت. توضیح: ${buyerNote}`,
          meta: {
            orderId: id,
            status: OrderStatus.SHIPPED_TO_BUYER,
            note: buyerNote,
            audience: 'BUYER',
          } as Prisma.InputJsonValue,
        },
        {
          userId: existing.sellerId,
          type: NotificationType.ORDER_STATUS_CHANGED,
          title: 'وضعیت سفارش تغییر کرد',
          message: `وضعیت سفارش به «ارسال به خریدار» تغییر یافت. توضیح: ${sellerNote}`,
          meta: {
            orderId: id,
            status: OrderStatus.SHIPPED_TO_BUYER,
            note: sellerNote,
            audience: 'SELLER',
          } as Prisma.InputJsonValue,
        },
      );
    }

    await this.dispatchHubNotifications(notifications);

    // در مرجوعی معاوضه، به‌محض اینکه هر دو کد رهگیری برگشت از هاب ثبت شد،
    // سرکِ پرداخت‌شده باید فوراً از بلوکه طرف مقابل آزاد و به پرداخت‌کننده برگردد
    // (بدون هزینه کارشناسی). این کار قبلاً به تایید دریافت/تایمر موکول می‌شد.
    if (isExchangeReturnFlow && nextBuyerTracking && nextSellerTracking) {
      await this.prisma.$transaction(async (tx) => {
        const locked = await tx.order.findUnique({
          where: { id },
          select: {
            id: true,
            type: true,
            buyerId: true,
            sellerId: true,
            listingId: true,
            exchangeOfferId: true,
            verificationFee: true,
            exchangeHubInspection: true,
          },
        });
        if (!locked || locked.type !== 'EXCHANGE') return;

        const insp =
          (locked.exchangeHubInspection as Record<string, unknown> | null) ??
          {};
        if (
          insp['resolution'] !== 'RETURN_BOTH_TO_SENDERS' ||
          typeof insp['refundsReleasedAt'] === 'string'
        ) {
          return;
        }

        const offer = locked.exchangeOfferId
          ? await tx.exchangeOffer.findUnique({
              where: { id: locked.exchangeOfferId },
              select: { extraPayment: true, isPayerMe: true },
            })
          : null;
        const verificationFee = Number(locked.verificationFee || 0);
        const extra = Number(offer?.extraPayment || 0);
        const buyerShare = verificationFee + (offer?.isPayerMe ? extra : 0);
        const sellerShare = verificationFee + (!offer?.isPayerMe ? extra : 0);
        const buyerRefundable = Math.max(0, buyerShare - verificationFee);
        const sellerRefundable = Math.max(0, sellerShare - verificationFee);

        if (offer?.isPayerMe && buyerRefundable > 0) {
          await this.walletService.refundExchangeExtraOnCancel(tx, {
            buyerId: locked.buyerId,
            sellerId: locked.sellerId,
            listingId: locked.listingId,
            orderId: locked.id,
            isPayerMe: true,
            buyerRefundable,
            sellerRefundable: 0,
          });
        }

        if (!offer?.isPayerMe && sellerRefundable > 0) {
          await this.walletService.refundExchangeExtraOnCancel(tx, {
            buyerId: locked.buyerId,
            sellerId: locked.sellerId,
            listingId: locked.listingId,
            orderId: locked.id,
            isPayerMe: false,
            buyerRefundable: 0,
            sellerRefundable,
          });
        }

        await tx.order.update({
          where: { id: locked.id },
          data: {
            exchangeHubInspection: {
              ...insp,
              refundsReleasedAt: new Date().toISOString(),
            } as Prisma.InputJsonValue,
          },
        });
      });
    }

    if (isDirectHubReturnFlow && returnShipmentCompleted) {
      await this.prisma.$transaction(async (tx) => {
        const locked = await tx.order.findUnique({
          where: { id },
          select: {
            id: true,
            type: true,
            status: true,
            buyerId: true,
            sellerId: true,
            listingId: true,
            totalAmount: true,
            sellerRevenue: true,
            cancelReason: true,
            tradeReputationAt: true,
          },
        });
        if (
          !locked ||
          locked.type === 'EXCHANGE' ||
          locked.status !== OrderStatus.CANCELLED
        ) {
          return;
        }

        await this.walletService.refundDirectOrderEscrowOnCancel(tx, {
          orderId: locked.id,
          listingId: locked.listingId,
          buyerId: locked.buyerId,
          sellerId: locked.sellerId,
          totalAmount: Number(locked.totalAmount || 0),
          sellerRevenue: Number(locked.sellerRevenue || 0),
          cancelReason:
            locked.cancelReason?.trim() ||
            'رد کارشناسی؛ مرجوع از هاب به فروشنده',
          refundReason: 'hub-inspection-rejected-return',
        });

        await this.orderReputation.recordTerminalOutcome(
          tx,
          {
            id: locked.id,
            buyerId: locked.buyerId,
            sellerId: locked.sellerId,
            tradeReputationAt: locked.tradeReputationAt,
          },
          OrderStatus.REJECTED_AT_HUB,
          'FAILURE',
          { failurePenalizeUserIds: [locked.sellerId] },
        );

        const rejectReason =
          locked.cancelReason?.trim() || 'رد کارشناسی؛ مرجوع از هاب به فروشنده';
        const listingRow = await tx.listing.findUnique({
          where: { id: locked.listingId },
          select: { title: true },
        });
        await this.listingCommand.rejectAfterTradeFailure(tx, {
          listingId: locked.listingId,
          sellerId: locked.sellerId,
          listingTitle: listingRow?.title ?? 'کالا',
          rejectionReason: rejectReason,
          source: 'hub-inspection',
          orderId: locked.id,
        });
      });
    }
    return updated;
  }

  async setTrackingCode(id: string, trackingCode: string) {
    const existing = await this.prisma.order.findUnique({
      where: { id },
      select: { id: true, buyerId: true, sellerId: true },
    });
    if (!existing) throw new NotFoundException('سفارش یافت نشد');

    const order = await this.prisma.order.update({
      where: { id },
      data: { trackingCode },
    });

    const message = `کد رهگیری سفارش شما: ${trackingCode}`;
    await this.dispatchHubNotifications([
      {
        userId: existing.buyerId,
        type: NotificationType.ORDER_STATUS_CHANGED,
        title: 'کد رهگیری ثبت شد',
        message,
        meta: { orderId: id, trackingCode } as Prisma.InputJsonValue,
      },
    ]);
    return order;
  }

  async setParticipantShipping(id: string, dto: SetParticipantShippingDto) {
    const existing = await this.prisma.order.findUnique({
      where: { id },
      select: {
        id: true,
        type: true,
        buyerId: true,
        sellerId: true,
        trackingCode: true,
        sellerTrackingCode: true,
      },
    });
    if (!existing) throw new NotFoundException('سفارش یافت نشد');
    if (!dto.sellerTrackingCode && !dto.buyerTrackingCode) {
      throw new BadRequestException('حداقل یک کد رهگیری باید ثبت شود');
    }
    if (existing.type !== 'EXCHANGE' && dto.buyerTrackingCode) {
      throw new BadRequestException(
        'کد رهگیری خریدار فقط برای سفارش‌های معاوضه قابل ثبت است',
      );
    }

    const updated = await this.prisma.order.update({
      where: { id },
      data: {
        trackingCode: dto.sellerTrackingCode ?? existing.trackingCode,
        sellerTrackingCode:
          existing.type === 'EXCHANGE'
            ? (dto.buyerTrackingCode ?? existing.sellerTrackingCode)
            : existing.sellerTrackingCode,
      },
    });

    const buyerMsgParts = [
      dto.sellerTrackingCode
        ? `کد رهگیری ارسال فروشنده: ${dto.sellerTrackingCode}`
        : null,
      existing.type === 'EXCHANGE' && dto.buyerTrackingCode
        ? `کد رهگیری ارسال شما: ${dto.buyerTrackingCode}`
        : null,
      dto.buyerNote ? `توضیح برای شما: ${dto.buyerNote}` : null,
    ].filter(Boolean);
    const sellerMsgParts = [
      dto.sellerTrackingCode
        ? `کد رهگیری ارسال شما: ${dto.sellerTrackingCode}`
        : null,
      existing.type === 'EXCHANGE' && dto.buyerTrackingCode
        ? `کد رهگیری ارسال خریدار: ${dto.buyerTrackingCode}`
        : null,
      dto.sellerNote ? `توضیح برای شما: ${dto.sellerNote}` : null,
    ].filter(Boolean);

    await this.dispatchHubNotifications([
      {
        userId: existing.buyerId,
        type: NotificationType.ORDER_STATUS_CHANGED,
        title: 'به‌روزرسانی اطلاعات ارسال',
        message: buyerMsgParts.length
          ? buyerMsgParts.join(' | ')
          : 'اطلاعات ارسال سفارش به‌روزرسانی شد.',
        meta: {
          orderId: id,
          sellerTrackingCode: dto.sellerTrackingCode ?? null,
          buyerTrackingCode: dto.buyerTrackingCode ?? null,
          buyerNote: dto.buyerNote ?? null,
          audience: 'BUYER',
          role: 'BUYER',
        } as Prisma.InputJsonValue,
      },
      {
        userId: existing.sellerId,
        type: NotificationType.ORDER_STATUS_CHANGED,
        title: 'به‌روزرسانی اطلاعات ارسال',
        message: sellerMsgParts.length
          ? sellerMsgParts.join(' | ')
          : 'اطلاعات ارسال سفارش به‌روزرسانی شد.',
        meta: {
          orderId: id,
          sellerTrackingCode: dto.sellerTrackingCode ?? null,
          buyerTrackingCode: dto.buyerTrackingCode ?? null,
          sellerNote: dto.sellerNote ?? null,
          audience: 'SELLER',
          role: 'SELLER',
        } as Prisma.InputJsonValue,
      },
    ]);

    return updated;
  }

  async setExchangeHubReceipt(id: string, dto: SetExchangeHubReceiptDto) {
    const existing = await this.prisma.order.findUnique({
      where: { id },
      select: {
        id: true,
        type: true,
        status: true,
        buyerId: true,
        sellerId: true,
        listingId: true,
        trackingCode: true,
        sellerTrackingCode: true,
        exchangeHubInspection: true,
      },
    });
    if (!existing) throw new NotFoundException('سفارش یافت نشد');
    if (existing.type !== 'EXCHANGE') {
      throw new BadRequestException(
        'این عملیات فقط برای سفارش معاوضه مجاز است',
      );
    }
    if (
      existing.status !== OrderStatus.SHIPPED_TO_HUB &&
      existing.status !== OrderStatus.RECEIVED_AT_HUB &&
      existing.status !== OrderStatus.CHECKING_AT_HUB
    ) {
      throw new BadRequestException(
        'سفارش در وضعیت مناسب برای ثبت دریافت مرسوله در هاب نیست',
      );
    }
    if (dto.received) {
      if (dto.side === 'LISTING' && !existing.trackingCode?.trim()) {
        throw new BadRequestException(
          'تا ثبت کد رهگیری ارسال فروشنده، امکان ثبت دریافت کالای آگهی در هاب نیست',
        );
      }
      if (dto.side === 'OFFER' && !existing.sellerTrackingCode?.trim()) {
        throw new BadRequestException(
          'تا ثبت کد رهگیری ارسال خریدار، امکان ثبت دریافت کالای پیشنهادی در هاب نیست',
        );
      }
    }

    const prev =
      (existing.exchangeHubInspection as Record<string, unknown> | null) ?? {};
    const wasListingReceived = Boolean(prev['sellerReceivedAtHub']);
    const wasOfferReceived = Boolean(prev['buyerReceivedAtHub']);
    const next = {
      ...prev,
      sellerReceivedAtHub:
        dto.side === 'LISTING'
          ? dto.received
          : wasListingReceived,
      buyerReceivedAtHub:
        dto.side === 'OFFER'
          ? dto.received
          : wasOfferReceived,
    };
    const bothReceived =
      Boolean(next.sellerReceivedAtHub) && Boolean(next.buyerReceivedAtHub);
    const targetStatus =
      existing.status === OrderStatus.CHECKING_AT_HUB
        ? OrderStatus.CHECKING_AT_HUB
        : bothReceived
          ? OrderStatus.RECEIVED_AT_HUB
          : OrderStatus.SHIPPED_TO_HUB;

    const updated = await this.prisma.order.update({
      where: { id },
      data: {
        status: targetStatus,
        exchangeHubInspection: next as Prisma.InputJsonValue,
      },
    });

    const isNewSideReceipt =
      dto.received &&
      ((dto.side === 'LISTING' && !wasListingReceived) ||
        (dto.side === 'OFFER' && !wasOfferReceived));
    if (isNewSideReceipt) {
      await this.operationalNotify.notifyExchangeHubItemReceived({
        orderId: id,
        buyerId: existing.buyerId,
        sellerId: existing.sellerId,
        listingId: existing.listingId,
        side: dto.side,
        bothReceived,
        status: targetStatus,
      });
    }

    return updated;
  }
}
