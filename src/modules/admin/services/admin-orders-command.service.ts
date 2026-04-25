import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import {
  ListingStatus,
  NotificationType,
  OrderStatus,
  Prisma,
  UserRole,
  WalletTransactionStatus,
  WalletTransactionType,
} from '@prisma/client';
import { PrismaService } from '../../../infrastructure/prisma/prisma.service';
import { AdminEscrowAction, SetHubShippingCodesDto } from '../dto/admin-order.dto';
import { AppSettingsService } from '../../../shared/settings/app-settings.service';

@Injectable()
export class AdminOrdersCommandService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly appSettings: AppSettingsService,
  ) {}

  async updateStatus(id: string, status: OrderStatus, note?: string) {
    const existing = await this.prisma.order.findUnique({
      where: { id },
      select: {
        id: true,
        buyerId: true,
        sellerId: true,
        status: true,
        type: true,
        trackingCode: true,
        sellerTrackingCode: true,
        packagingVideo: true,
        buyerPackagingVideo: true,
        listing: {
          select: {
            id: true,
            title: true,
            thumbnail: true,
          },
        },
      },
    });
    if (!existing) throw new NotFoundException('سفارش یافت نشد');

    const order = await this.prisma.order.update({
      where: { id },
      data: {
        status,
        ...(note ? { trackingCode: existing.status ? undefined : undefined } : {}),
      },
    });

    if (status === OrderStatus.REJECTED_AT_HUB && note?.trim()) {
      const apiUrl = this.appSettings.getApiUrl().replace(/\/$/, '');
      const listingUrl = `${apiUrl}/listing/${existing.listing.id}`;
      const packagingVideoUrl = existing.packagingVideo
        ? `${apiUrl}/uploads/orders/videos/${existing.packagingVideo}`
        : null;
      const buyerPackagingVideoUrl = existing.buyerPackagingVideo
        ? `${apiUrl}/uploads/orders/videos/${existing.buyerPackagingVideo}`
        : null;
      const ticketMessage = [
        'نتیجه کارشناسی: رد شد.',
        `سفارش: #${id.slice(-6)}`,
        `کالا: ${existing.listing.title}`,
        `لینک آگهی: ${listingUrl}`,
        `کد رهگیری فروشنده: ${existing.trackingCode ?? 'ثبت نشده'}`,
        existing.type === 'EXCHANGE'
          ? `کد رهگیری طرف مقابل: ${existing.sellerTrackingCode ?? 'ثبت نشده'}`
          : null,
        packagingVideoUrl ? `ویدیوی بسته بندی فروشنده: ${packagingVideoUrl}` : null,
        buyerPackagingVideoUrl
          ? `ویدیوی بسته بندی طرف مقابل: ${buyerPackagingVideoUrl}`
          : null,
        `توضیح کارشناسی: ${note.trim()}`,
      ]
        .filter(Boolean)
        .join('\n');

      const buyerTicket = await this.prisma.ticket.create({
        data: {
          userId: existing.buyerId,
          subject: `رد کارشناسی سفارش [ORDER:${id}]`,
          status: 'OPEN',
          messages: {
            create: {
              senderRole: UserRole.ADMIN,
              message: ticketMessage,
            },
          },
        },
        select: { id: true },
      });
      const sellerTicket = await this.prisma.ticket.create({
        data: {
          userId: existing.sellerId,
          subject: `رد کارشناسی سفارش [ORDER:${id}]`,
          status: 'OPEN',
          messages: {
            create: {
              senderRole: UserRole.ADMIN,
              message: ticketMessage,
            },
          },
        },
        select: { id: true },
      });

      await this.prisma.notification.createMany({
        data: [
          {
            userId: existing.buyerId,
            type: NotificationType.TICKET_REPLY,
            title: 'تیکت رسیدگی به رد کارشناسی ثبت شد',
            message: `برای سفارش #${id.slice(-6)} تیکت پشتیبانی ایجاد شد.`,
            meta: { orderId: id, ticketId: buyerTicket.id } as Prisma.InputJsonValue,
          },
          {
            userId: existing.sellerId,
            type: NotificationType.TICKET_REPLY,
            title: 'تیکت رسیدگی به رد کارشناسی ثبت شد',
            message: `برای سفارش #${id.slice(-6)} تیکت پشتیبانی ایجاد شد.`,
            meta: { orderId: id, ticketId: sellerTicket.id } as Prisma.InputJsonValue,
          },
        ],
      });
    }

    await this.notifyParties(existing.buyerId, existing.sellerId, id, status, note);
    return order;
  }

  async setHubShippingCodes(id: string, dto: SetHubShippingCodesDto) {
    const existing = await this.prisma.order.findUnique({
      where: { id },
      select: { id: true, type: true, buyerId: true, sellerId: true, status: true },
    });
    if (!existing) throw new NotFoundException('سفارش یافت نشد');
    if (
      existing.status !== OrderStatus.VERIFIED_AT_HUB &&
      existing.status !== OrderStatus.SHIPPED_TO_BUYER
    ) {
      throw new BadRequestException('این سفارش در وضعیت مناسب برای ارسال از هاب نیست');
    }

    const updated = await this.prisma.order.update({
      where: { id },
      data: {
        hubToBuyerTrackingCode: dto.hubToBuyerTrackingCode,
        hubToSellerTrackingCode:
          existing.type === 'EXCHANGE' ? dto.hubToSellerTrackingCode : undefined,
        status: OrderStatus.SHIPPED_TO_BUYER,
      },
    });

    const buyerNote =
      dto.note ??
      (existing.type === 'EXCHANGE'
        ? 'مرسوله‌های خروجی از هاب ارسال شد و کد رهگیری شما ثبت گردید.'
        : 'مرسوله از هاب به مقصد شما ارسال شد و کد رهگیری ثبت گردید.');
    const sellerNote =
      dto.note ??
      (existing.type === 'EXCHANGE'
        ? 'مرسوله‌های خروجی از هاب ارسال شد و کد رهگیری‌ها ثبت گردید.'
        : 'مرسوله از هاب برای خریدار ارسال شد و کد رهگیری ثبت گردید.');

    await this.prisma.notification.createMany({
      data: [
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
      ],
    });
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
    await this.prisma.notification.createMany({
      data: [
        {
          userId: existing.buyerId,
          type: NotificationType.ORDER_STATUS_CHANGED,
          title: 'کد رهگیری ثبت شد',
          message,
          meta: { orderId: id, trackingCode } as Prisma.InputJsonValue,
        },
      ],
    });
    return order;
  }

  async resolveEscrow(id: string, action: AdminEscrowAction, note?: string) {
    return this.prisma.$transaction(async (tx) => {
      const order = await tx.order.findUnique({
        where: { id },
        select: {
          id: true,
          buyerId: true,
          sellerId: true,
          listingId: true,
          status: true,
          sellerRevenue: true,
          totalAmount: true,
        },
      });
      if (!order) throw new NotFoundException('سفارش یافت نشد');
      if (
        order.status === OrderStatus.CANCELLED ||
        order.status === OrderStatus.COMPLETED
      ) {
        throw new BadRequestException('این سفارش قبلاً تعیین تکلیف شده است');
      }

      const sellerRevenue = Number(order.sellerRevenue);
      const totalAmount = Number(order.totalAmount);

      if (action === AdminEscrowAction.RELEASE_TO_SELLER) {
        if (sellerRevenue > 0) {
          await tx.wallet.upsert({
            where: { userId: order.sellerId },
            create: {
              userId: order.sellerId,
              balanceAvailable: sellerRevenue,
              balanceBlocked: 0,
            },
            update: {
              balanceBlocked: { decrement: sellerRevenue },
              balanceAvailable: { increment: sellerRevenue },
            },
          });
          await tx.walletTransaction.create({
            data: {
              wallet: { connect: { userId: order.sellerId } },
              amount: sellerRevenue,
              type: WalletTransactionType.UNBLOCK,
              status: WalletTransactionStatus.SUCCESS,
              referenceId: order.id,
              meta: {
                description: 'آزادسازی دستی وجه بلوکه سفارش توسط ادمین',
                adminNote: note ?? null,
              },
            },
          });
        }

        const updated = await tx.order.update({
          where: { id: order.id },
          data: { status: OrderStatus.COMPLETED },
        });
        await this.notifyParties(
          order.buyerId,
          order.sellerId,
          order.id,
          OrderStatus.COMPLETED,
          note ?? 'تسویه دستی سفارش توسط ادمین انجام شد',
        );
        return updated;
      }

      if (sellerRevenue > 0) {
        await tx.wallet.upsert({
          where: { userId: order.sellerId },
          create: {
            userId: order.sellerId,
            balanceAvailable: 0,
            balanceBlocked: 0,
          },
          update: { balanceBlocked: { decrement: sellerRevenue } },
        });
      }
      if (totalAmount > 0) {
        await tx.wallet.upsert({
          where: { userId: order.buyerId },
          create: {
            userId: order.buyerId,
            balanceAvailable: totalAmount,
            balanceBlocked: 0,
          },
          update: { balanceAvailable: { increment: totalAmount } },
        });
        await tx.walletTransaction.create({
          data: {
            wallet: { connect: { userId: order.buyerId } },
            amount: totalAmount,
            type: WalletTransactionType.REFUND,
            status: WalletTransactionStatus.SUCCESS,
            referenceId: order.id,
            meta: {
              refundReason: 'admin-manual-refund',
              adminNote: note ?? null,
            },
          },
        });
      }

      const updated = await tx.order.update({
        where: { id: order.id },
        data: { status: OrderStatus.CANCELLED, cancelReason: note ?? 'لغو دستی توسط ادمین' },
      });
      await tx.listing.update({
        where: { id: order.listingId },
        data: { status: ListingStatus.APPROVED },
      });
      await this.notifyParties(
        order.buyerId,
        order.sellerId,
        order.id,
        OrderStatus.CANCELLED,
        note ?? 'لغو دستی سفارش و بازگشت وجه توسط ادمین انجام شد',
      );
      return updated;
    });
  }

  private async notifyParties(
    buyerId: string,
    sellerId: string,
    orderId: string,
    status: OrderStatus,
    note?: string,
  ): Promise<void> {
    const label = STATUS_LABELS[status] ?? status;
    const title = `وضعیت سفارش تغییر کرد`;
    const message = note
      ? `وضعیت سفارش به «${label}» تغییر یافت. توضیح: ${note}`
      : `وضعیت سفارش به «${label}» تغییر یافت.`;
    const meta = { orderId, status, note } as Prisma.InputJsonValue;

    await this.prisma.notification.createMany({
      data: [
        { userId: buyerId, type: NotificationType.ORDER_STATUS_CHANGED, title, message, meta },
        { userId: sellerId, type: NotificationType.ORDER_STATUS_CHANGED, title, message, meta },
      ],
    });
  }
}

const STATUS_LABELS: Partial<Record<OrderStatus, string>> = {
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
  COMPLETED: 'تکمیل شد',
  DISPUTED: 'اختلاف',
  CANCELLED: 'لغو شد',
};
