import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import {
  ListingStatus,
  ListingType,
  NotificationType,
  OrderStatus,
  Prisma,
  UserRole,
  WalletTransactionStatus,
  WalletTransactionType,
} from '@prisma/client';
import { PrismaService } from '../../../infrastructure/prisma/prisma.service';
import { AdminEscrowAction, ResolveOrderEscrowDto, SetHubShippingCodesDto, SetParticipantShippingDto } from '../dto/admin-order.dto';
import { AppSettingsService } from '../../../shared/settings/app-settings.service';
import { FeeCalculatorService } from '../../fees/fee-calculator.service';

@Injectable()
export class AdminOrdersCommandService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly appSettings: AppSettingsService,
    private readonly feeCalculator: FeeCalculatorService,
  ) {}

  async updateStatus(
    id: string,
    status: OrderStatus,
    note?: string,
    rejectedReturnTrackingCode?: string,
  ) {
    const existing = await this.prisma.order.findUnique({
      where: { id },
      select: {
        id: true,
        buyerId: true,
        sellerId: true,
        status: true,
        type: true,
        listingId: true,
        totalAmount: true,
        sellerRevenue: true,
        returnTrackingCode: true,
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

    if (status === OrderStatus.REJECTED_AT_HUB) {
      const normalizedNote = note?.trim();
      if (!normalizedNote) {
        throw new BadRequestException('برای رد کارشناسی، ثبت توضیح اجباری است');
      }

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
        `توضیح کارشناسی: ${normalizedNote}`,
      ]
        .filter(Boolean)
        .join('\n');
      return this.prisma.$transaction(async (tx) => {
        const updatedOrder = await tx.order.update({
          where: { id },
          data: {
            status: OrderStatus.REJECTED_AT_HUB,
            cancelReason: normalizedNote,
          },
        });

        const sellerTicket = await tx.ticket.create({
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

        await tx.notification.create({
          data: {
            userId: existing.sellerId,
            type: NotificationType.TICKET_REPLY,
            title: 'تیکت رد کارشناسی برای فروشنده ثبت شد',
            message: `برای سفارش #${id.slice(-6)} تیکت پشتیبانی ایجاد شد.`,
            meta: { orderId: id, ticketId: sellerTicket.id } as Prisma.InputJsonValue,
          },
        });

        await this.notifyParties(
          existing.buyerId,
          existing.sellerId,
          id,
          OrderStatus.REJECTED_AT_HUB,
          normalizedNote,
        );

        return updatedOrder;
      });
    }

    if (status === OrderStatus.CANCELLED) {
      const normalizedNote = note?.trim();
      const normalizedReturnTrackingCode = rejectedReturnTrackingCode?.trim();
      if (
        existing.status === OrderStatus.REJECTED_AT_HUB &&
        (!normalizedReturnTrackingCode || normalizedReturnTrackingCode.length < 3)
      ) {
        throw new BadRequestException('برای لغو پس از رد کارشناسی، کد رهگیری برگشت به فروشنده اجباری است');
      }

      return this.prisma.$transaction(async (tx) => {
        const totalAmount = Number(existing.totalAmount || 0);
        const sellerRevenue = Number(existing.sellerRevenue || 0);

        if (sellerRevenue > 0) {
          await tx.wallet.upsert({
            where: { userId: existing.sellerId },
            create: {
              userId: existing.sellerId,
              balanceAvailable: 0,
              balanceBlocked: 0,
            },
            update: { balanceBlocked: { decrement: sellerRevenue } },
          });
          await tx.walletTransaction.create({
            data: {
              wallet: { connect: { userId: existing.sellerId } },
              amount: sellerRevenue,
              type: WalletTransactionType.PENALTY,
              status: WalletTransactionStatus.SUCCESS,
              referenceId: existing.id,
              meta: {
                kind: 'order-escrow',
                phase: 'seller_blocked_debit',
                debitReason: 'admin-status-cancelled',
                adminNote: normalizedNote ?? null,
                description: 'کسر از موجودی بلوکه فروشنده به‌دلیل لغو سفارش و بازگشت وجه خریدار',
              },
            },
          });
        }

        if (totalAmount > 0) {
          await tx.wallet.upsert({
            where: { userId: existing.buyerId },
            create: {
              userId: existing.buyerId,
              balanceAvailable: totalAmount,
              balanceBlocked: 0,
            },
            update: { balanceAvailable: { increment: totalAmount } },
          });
          await tx.walletTransaction.create({
            data: {
              wallet: { connect: { userId: existing.buyerId } },
              amount: totalAmount,
              type: WalletTransactionType.REFUND,
              status: WalletTransactionStatus.SUCCESS,
              referenceId: existing.id,
              meta: {
                refundReason: 'admin-status-cancelled',
                adminNote: normalizedNote ?? null,
                ...(normalizedReturnTrackingCode
                  ? { returnTrackingCode: normalizedReturnTrackingCode }
                  : {}),
              },
            },
          });
        }

        const updatedOrder = await tx.order.update({
          where: { id: existing.id },
          data: {
            status: OrderStatus.CANCELLED,
            cancelReason: normalizedNote ?? 'لغو دستی سفارش توسط ادمین',
            returnTrackingCode:
              existing.status === OrderStatus.REJECTED_AT_HUB
                ? normalizedReturnTrackingCode
                : existing.returnTrackingCode,
            returnShippedAt:
              existing.status === OrderStatus.REJECTED_AT_HUB ? new Date() : undefined,
          },
        });

        await tx.listing.update({
          where: { id: existing.listingId },
          data: { status: ListingStatus.APPROVED },
        });

        const buyerTicketMessage = [
          `سفارش «${existing.listing.title}» لغو شد.`,
          `علت: ${normalizedNote || 'لغو سفارش توسط پشتیبانی'}`,
          `مبلغ ${totalAmount.toLocaleString('fa-IR')} تومان به کیف پول شما اضافه شد.`,
        ].join('\n');
        const buyerTicket = await tx.ticket.create({
          data: {
            userId: existing.buyerId,
            subject: `لغو سفارش و بازگشت وجه [ORDER:${existing.id}]`,
            status: 'ANSWERED',
            messages: {
              create: {
                senderRole: UserRole.ADMIN,
                message: buyerTicketMessage,
              },
            },
          },
          select: { id: true },
        });

        await tx.notification.create({
          data: {
            userId: existing.buyerId,
            type: NotificationType.TICKET_REPLY,
            title: 'تیکت لغو سفارش ثبت شد',
            message: `برای سفارش #${existing.id.slice(-6)} تیکت ثبت شد و مبلغ به کیف پول شما برگشت.`,
            meta: { orderId: existing.id, ticketId: buyerTicket.id } as Prisma.InputJsonValue,
          },
        });

        await this.notifyParties(
          existing.buyerId,
          existing.sellerId,
          existing.id,
          OrderStatus.CANCELLED,
          normalizedNote ?? 'لغو سفارش و بازگشت وجه انجام شد',
        );

        return updatedOrder;
      });
    }

    const order = await this.prisma.order.update({
      where: { id },
      data: { status },
    });
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
      throw new BadRequestException('کد رهگیری خریدار فقط برای سفارش‌های معاوضه قابل ثبت است');
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
      dto.sellerTrackingCode ? `کد رهگیری ارسال فروشنده: ${dto.sellerTrackingCode}` : null,
      existing.type === 'EXCHANGE' && dto.buyerTrackingCode ? `کد رهگیری ارسال شما: ${dto.buyerTrackingCode}` : null,
      dto.buyerNote ? `توضیح برای شما: ${dto.buyerNote}` : null,
    ].filter(Boolean);
    const sellerMsgParts = [
      dto.sellerTrackingCode ? `کد رهگیری ارسال شما: ${dto.sellerTrackingCode}` : null,
      existing.type === 'EXCHANGE' && dto.buyerTrackingCode ? `کد رهگیری ارسال خریدار: ${dto.buyerTrackingCode}` : null,
      dto.sellerNote ? `توضیح برای شما: ${dto.sellerNote}` : null,
    ].filter(Boolean);

    await this.prisma.notification.createMany({
      data: [
        {
          userId: existing.buyerId,
          type: NotificationType.ORDER_STATUS_CHANGED,
          title: 'به‌روزرسانی اطلاعات ارسال',
          message: buyerMsgParts.length ? buyerMsgParts.join(' | ') : 'اطلاعات ارسال سفارش به‌روزرسانی شد.',
          meta: {
            orderId: id,
            sellerTrackingCode: dto.sellerTrackingCode ?? null,
            buyerTrackingCode: dto.buyerTrackingCode ?? null,
            buyerNote: dto.buyerNote ?? null,
          } as Prisma.InputJsonValue,
        },
        {
          userId: existing.sellerId,
          type: NotificationType.ORDER_STATUS_CHANGED,
          title: 'به‌روزرسانی اطلاعات ارسال',
          message: sellerMsgParts.length ? sellerMsgParts.join(' | ') : 'اطلاعات ارسال سفارش به‌روزرسانی شد.',
          meta: {
            orderId: id,
            sellerTrackingCode: dto.sellerTrackingCode ?? null,
            buyerTrackingCode: dto.buyerTrackingCode ?? null,
            sellerNote: dto.sellerNote ?? null,
          } as Prisma.InputJsonValue,
        },
      ],
    });

    return updated;
  }

  async resolveEscrow(id: string, dto: ResolveOrderEscrowDto) {
    return this.prisma.$transaction(async (tx) => {
      const action = dto.action;
      const note = dto.note;
      const order = await tx.order.findUnique({
        where: { id },
        select: {
          id: true,
          type: true,
          buyerId: true,
          sellerId: true,
          listingId: true,
          listing: {
            select: {
              title: true,
              sellerRequiresVerification: true,
              categoryId: true,
            },
          },
          finalPrice: true,
          status: true,
          sellerRevenue: true,
          totalAmount: true,
          platformFee: true,
          shippingCost: true,
          verificationFee: true,
          requiresVerification: true,
          returnTrackingCode: true,
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
      const finalPrice = Number(order.finalPrice || 0);
      const shippingCost = Number(order.shippingCost || 0);
      const verificationFee = Number(order.verificationFee || 0);
      const platformFee = Number(order.platformFee || 0);
      const sellerVerificationFee =
        order.requiresVerification && Boolean(order.listing?.sellerRequiresVerification)
          ? verificationFee
          : 0;
      const verificationChargedToBuyer =
        order.requiresVerification && !order.listing?.sellerRequiresVerification
          ? verificationFee
          : 0;
      const refundableToBuyerAfterReturn = Math.max(
        0,
        totalAmount - shippingCost - verificationChargedToBuyer,
      );
      const maxNegotiableRefund = Math.max(0, finalPrice);

      if (
        order.type === 'EXCHANGE' &&
        action !== AdminEscrowAction.RELEASE_TO_SELLER &&
        action !== AdminEscrowAction.REFUND_TO_BUYER
      ) {
        throw new BadRequestException('برای معاوضه، این نوع تصمیم مالی باید دستی انجام شود');
      }

      if (
        action === AdminEscrowAction.REFUND_TO_BUYER &&
        order.status === OrderStatus.RETURN_REQUESTED
      ) {
        throw new BadRequestException('ابتدا خریدار باید کد رهگیری مرجوعی را ثبت کند');
      }

      if (
        action === AdminEscrowAction.REFUND_TO_BUYER &&
        order.status === OrderStatus.RETURN_SHIPPED
      ) {
        throw new BadRequestException(
          'این سفارش در مرحله مرجوعی ثبت‌شده است؛ برای بازگشت وجه فقط از «تایید مرجوعی و بازگشت وجه» استفاده کنید تا دوبار بازپرداخت نشود.',
        );
      }

      if (
        action === AdminEscrowAction.REFUND_TO_BUYER &&
        (order.status === OrderStatus.DELIVERED || order.status === OrderStatus.DISPUTED)
      ) {
        const updated = await tx.order.update({
          where: { id: order.id },
          data: {
            status: OrderStatus.RETURN_REQUESTED,
            cancelReason: note ?? 'مرجوعی کالا توسط خریدار در انتظار ثبت است',
          },
        });
        await this.notifyParties(
          order.buyerId,
          order.sellerId,
          order.id,
          OrderStatus.RETURN_REQUESTED,
          note ?? 'خریدار باید کالا را مرجوع و کد رهگیری را ثبت کند',
        );
        return updated;
      }

      if (action === AdminEscrowAction.PARTIAL_REFUND_AND_CONTINUE) {
        const refundAmount = Number(dto.refundToBuyerAmount ?? 0);
        if (!Number.isFinite(refundAmount) || refundAmount <= 0) {
          throw new BadRequestException('مبلغ بازپرداخت جزئی نامعتبر است');
        }
        if (refundAmount > maxNegotiableRefund) {
          throw new BadRequestException(
            `حداکثر مبلغ قابل بازپرداخت با توجه به کسر کارشناسی و سود مجموعه ${maxNegotiableRefund.toLocaleString('fa-IR')} تومان است`,
          );
        }
        if (refundAmount > sellerRevenue) {
          throw new BadRequestException('مبلغ بازپرداخت از سهم بلوکه‌شده فروشنده بیشتر است');
        }

        const sellerWallet = await tx.wallet.findUnique({
          where: { userId: order.sellerId },
          select: { balanceBlocked: true },
        });
        const sellerBlockedNow = Number(sellerWallet?.balanceBlocked ?? 0);
        if (refundAmount > sellerBlockedNow) {
          throw new BadRequestException('مبلغ بازپرداخت از موجودی بلوکه فعلی فروشنده بیشتر است');
        }

        const recalculatedFinalPrice = Math.max(0, finalPrice - refundAmount);
        const listingTypeForFee =
          order.type === 'AUCTION'
            ? ListingType.AUCTION
            : order.type === 'EXCHANGE'
              ? ListingType.EXCHANGE
              : ListingType.DIRECT;
        const recalculatedPlatformFee = Number(
          await this.feeCalculator.calculateFee(
            listingTypeForFee,
            order.listing.categoryId,
            recalculatedFinalPrice,
          ),
        );
        const recalculatedSellerRevenue = Math.max(
          0,
          recalculatedFinalPrice - recalculatedPlatformFee + shippingCost - sellerVerificationFee,
        );
        const recalculatedTotalAmount = Math.max(0, totalAmount - refundAmount);

        await tx.wallet.upsert({
          where: { userId: order.sellerId },
          create: {
            userId: order.sellerId,
            balanceAvailable: 0,
            balanceBlocked: 0,
          },
          update: { balanceBlocked: { decrement: refundAmount } },
        });
        await tx.walletTransaction.create({
          data: {
            wallet: { connect: { userId: order.sellerId } },
            amount: refundAmount,
            type: WalletTransactionType.PENALTY,
            status: WalletTransactionStatus.SUCCESS,
            referenceId: order.id,
            meta: {
              kind: 'order-escrow',
              phase: 'seller_blocked_debit',
              debitReason: 'admin-partial-refund',
              orderId: order.id,
              listingId: order.listingId,
              listingTitle: order.listing?.title ?? null,
              settlementKind: 'partial_refund_agreement',
              agreementAmount: refundAmount,
              adminNote: note ?? null,
              description: `کسر توافقی ${refundAmount.toLocaleString('fa-IR')} تومان از موجودی بلوکه فروشنده برای سفارش «${order.listing?.title ?? 'کالا'}»`,
            },
          },
        });
        await tx.wallet.upsert({
          where: { userId: order.buyerId },
          create: {
            userId: order.buyerId,
            balanceAvailable: refundAmount,
            balanceBlocked: 0,
          },
          update: { balanceAvailable: { increment: refundAmount } },
        });
        await tx.walletTransaction.create({
          data: {
            wallet: { connect: { userId: order.buyerId } },
            amount: refundAmount,
            type: WalletTransactionType.REFUND,
            status: WalletTransactionStatus.SUCCESS,
            referenceId: order.id,
            meta: {
              refundReason: 'admin-partial-refund-and-continue',
              kind: 'order-escrow',
              phase: 'buyer_refund_agreement',
              orderId: order.id,
              listingId: order.listingId,
              listingTitle: order.listing?.title ?? null,
              settlementKind: 'partial_refund_agreement',
              agreementAmount: refundAmount,
              adminNote: note ?? null,
              baseAfterCostsAndProfit: maxNegotiableRefund,
              description: `بازگشت توافقی ${refundAmount.toLocaleString('fa-IR')} تومان به کیف پول خریدار برای سفارش «${order.listing?.title ?? 'کالا'}»`,
            },
          },
        });

        const buyerAgreementTicketMessage = [
          `برای سفارش «${order.listing?.title ?? 'کالا'}» توافق مالی ثبت شد.`,
          `مبلغ ${refundAmount.toLocaleString('fa-IR')} تومان به کیف پول شما اضافه شد.`,
          'این مبلغ از موجودی بلوکه فروشنده کسر و به‌صورت توافقی به شما بازگردانده شد.',
          note ? `توضیح ادمین: ${note}` : null,
        ]
          .filter(Boolean)
          .join('\n');
        const sellerAgreementTicketMessage = [
          `برای سفارش «${order.listing?.title ?? 'کالا'}» توافق مالی ثبت شد.`,
          `مبلغ ${refundAmount.toLocaleString('fa-IR')} تومان از موجودی بلوکه شما کسر شد.`,
          'این مبلغ به‌صورت توافقی به کیف پول خریدار اضافه شد و سفارش ادامه پیدا می‌کند.',
          note ? `توضیح ادمین: ${note}` : null,
        ]
          .filter(Boolean)
          .join('\n');

        const [buyerAgreementTicket, sellerAgreementTicket] = await Promise.all([
          tx.ticket.create({
            data: {
              userId: order.buyerId,
              subject: `توافق مالی سفارش [ORDER:${order.id}]`,
              status: 'ANSWERED',
              messages: {
                create: {
                  senderRole: UserRole.ADMIN,
                  message: buyerAgreementTicketMessage,
                },
              },
            },
            select: { id: true },
          }),
          tx.ticket.create({
            data: {
              userId: order.sellerId,
              subject: `توافق مالی سفارش [ORDER:${order.id}]`,
              status: 'ANSWERED',
              messages: {
                create: {
                  senderRole: UserRole.ADMIN,
                  message: sellerAgreementTicketMessage,
                },
              },
            },
            select: { id: true },
          }),
        ]);

        await tx.notification.createMany({
          data: [
            {
              userId: order.buyerId,
              type: NotificationType.TICKET_REPLY,
              title: 'تیکت توافق مالی ثبت شد',
              message: `برای سفارش #${order.id.slice(-6)} مبلغ ${refundAmount.toLocaleString('fa-IR')} تومان به کیف پول شما اضافه شد.`,
              meta: {
                orderId: order.id,
                ticketId: buyerAgreementTicket.id,
                agreementAmount: refundAmount,
                settlementKind: 'partial_refund_agreement',
              } as Prisma.InputJsonValue,
            },
            {
              userId: order.sellerId,
              type: NotificationType.TICKET_REPLY,
              title: 'تیکت توافق مالی ثبت شد',
              message: `برای سفارش #${order.id.slice(-6)} مبلغ ${refundAmount.toLocaleString('fa-IR')} تومان از سهم فروش شما کسر شد.`,
              meta: {
                orderId: order.id,
                ticketId: sellerAgreementTicket.id,
                agreementAmount: refundAmount,
                settlementKind: 'partial_refund_agreement',
              } as Prisma.InputJsonValue,
            },
          ],
        });

        const updated = await tx.order.update({
          where: { id: order.id },
          data: {
            status: OrderStatus.VERIFIED_AT_HUB,
            finalPrice: recalculatedFinalPrice,
            platformFee: recalculatedPlatformFee,
            sellerRevenue: recalculatedSellerRevenue,
            totalAmount: recalculatedTotalAmount,
            cancelReason: [
              `بازپرداخت جزئی: ${refundAmount} تومان`,
              `توافق: مبلغ ${refundAmount} تومان با رضایت طرفین به خریدار بازگشت داده شد`,
              `مبلغ معامله (قبل): ${finalPrice} تومان`,
              `مبلغ معامله (بعد): ${recalculatedFinalPrice} تومان`,
              `کارمزد پلتفرم (قبل): ${platformFee} تومان`,
              `کارمزد پلتفرم (بعد): ${recalculatedPlatformFee} تومان`,
              `سهم فروشنده (قبل): ${sellerRevenue} تومان`,
              `سهم فروشنده (بعد): ${recalculatedSellerRevenue} تومان`,
              note ? `توضیح: ${note}` : null,
            ].filter(Boolean).join('\n'),
          },
        });
        await this.notifyParties(
          order.buyerId,
          order.sellerId,
          order.id,
          OrderStatus.VERIFIED_AT_HUB,
          `بازپرداخت جزئی ${refundAmount.toLocaleString('fa-IR')} تومان اعمال شد و سفارش ادامه یافت.`,
        );
        return updated;
      }

      if (action === AdminEscrowAction.REQUEST_RETURN_FROM_BUYER) {
        const returnAddress = (dto.returnAddress ?? '').trim();
        const returnPostalCode = (dto.returnPostalCode ?? '').trim();
        if (returnAddress.length < 10) {
          throw new BadRequestException('برای مرجوعی، آدرس مقصد الزامی است');
        }
        if (returnPostalCode.length < 5) {
          throw new BadRequestException('برای مرجوعی، کدپستی مقصد الزامی است');
        }
        const updated = await tx.order.update({
          where: { id: order.id },
          data: {
            status: OrderStatus.RETURN_REQUESTED,
            cancelReason: [
              'مرجوعی مورد انتظار از خریدار',
              `آدرس مقصد: ${returnAddress}`,
              `کدپستی مقصد: ${returnPostalCode}`,
              note ? `توضیح: ${note}` : null,
            ].filter(Boolean).join('\n'),
          },
        });
        await this.notifyParties(
          order.buyerId,
          order.sellerId,
          order.id,
          OrderStatus.RETURN_REQUESTED,
          'خریدار باید کالا را به آدرس اعلام‌شده مرجوع و کد رهگیری ثبت کند.',
        );
        return updated;
      }

      if (action === AdminEscrowAction.CONFIRM_RETURN_AND_REFUND) {
        if (order.status !== OrderStatus.RETURN_SHIPPED) {
          throw new BadRequestException('ابتدا باید خریدار کد رهگیری مرجوعی را ثبت کرده باشد');
        }
        const claimed = await tx.order.updateMany({
          where: {
            id: order.id,
            status: OrderStatus.RETURN_SHIPPED,
            returnConfirmedAt: null,
          },
          data: {
            status: OrderStatus.CANCELLED,
            cancelReason: note ?? 'مرجوعی تایید شد و بازگشت وجه انجام شد',
            returnConfirmedAt: new Date(),
          },
        });
        if (claimed.count === 0) {
          const cur = await tx.order.findUnique({
            where: { id: order.id },
            select: { returnConfirmedAt: true, status: true },
          });
          if (cur?.returnConfirmedAt || cur?.status === OrderStatus.CANCELLED) {
            throw new BadRequestException('مرجوعی قبلاً تایید شده و بازگشت وجه ثبت شده است');
          }
          throw new BadRequestException('این سفارش در وضعیت مناسب برای تایید مرجوعی نیست');
        }
        if (sellerRevenue > 0) {
          await tx.wallet.upsert({
            where: { userId: order.sellerId },
            create: { userId: order.sellerId, balanceAvailable: 0, balanceBlocked: 0 },
            update: { balanceBlocked: { decrement: sellerRevenue } },
          });
          await tx.walletTransaction.create({
            data: {
              wallet: { connect: { userId: order.sellerId } },
              amount: sellerRevenue,
              type: WalletTransactionType.PENALTY,
              status: WalletTransactionStatus.SUCCESS,
              referenceId: order.id,
              meta: {
                kind: 'order-escrow',
                phase: 'seller_blocked_debit',
                debitReason: 'confirm-return-and-refund',
                adminNote: note ?? null,
                description: 'کسر از موجودی بلوکه فروشنده پس از تایید مرجوعی و بازپرداخت کامل',
              },
            },
          });
        }
        if (refundableToBuyerAfterReturn > 0) {
          await tx.wallet.upsert({
            where: { userId: order.buyerId },
            create: { userId: order.buyerId, balanceAvailable: refundableToBuyerAfterReturn, balanceBlocked: 0 },
            update: { balanceAvailable: { increment: refundableToBuyerAfterReturn } },
          });
          await tx.walletTransaction.create({
            data: {
              wallet: { connect: { userId: order.buyerId } },
              amount: refundableToBuyerAfterReturn,
              type: WalletTransactionType.REFUND,
              status: WalletTransactionStatus.SUCCESS,
              referenceId: order.id,
              meta: {
                refundReason: 'return-confirmed-by-admin',
                adminNote: note ?? null,
                shippingCostExcluded: shippingCost,
                verificationFeeExcluded: verificationChargedToBuyer,
              },
            },
          });
        }
        await this.notifyParties(
          order.buyerId,
          order.sellerId,
          order.id,
          OrderStatus.CANCELLED,
          note ?? 'مرجوعی تایید شد و مبلغ به خریدار بازگشت.',
        );
        return tx.order.findUniqueOrThrow({ where: { id: order.id } });
      }

      if (action === AdminEscrowAction.RELEASE_TO_SELLER) {
        // در معاوضه، هنگام برگشت وجه به فروشنده در کنسلی/اختلاف،
        // هزینه کارشناسی غیرقابل‌عودت است و کارمزد معامله نباید کسر شود.
        const refundableToSeller =
          order.type === 'EXCHANGE'
            ? Math.max(0, totalAmount - Number(order.verificationFee || 0))
            : sellerRevenue;
        if (refundableToSeller > 0) {
          await tx.wallet.upsert({
            where: { userId: order.sellerId },
            create: {
              userId: order.sellerId,
              balanceAvailable: refundableToSeller,
              balanceBlocked: 0,
            },
            update: {
              balanceBlocked: { decrement: refundableToSeller },
              balanceAvailable: { increment: refundableToSeller },
            },
          });
          await tx.walletTransaction.create({
            data: {
              wallet: { connect: { userId: order.sellerId } },
              amount: refundableToSeller,
              type: WalletTransactionType.UNBLOCK,
              status: WalletTransactionStatus.SUCCESS,
              referenceId: order.id,
              meta: {
                description:
                  order.type === 'EXCHANGE'
                    ? 'برگشت وجه به فروشنده (بدون عودت کارشناسی) توسط ادمین'
                    : 'آزادسازی دستی وجه بلوکه سفارش توسط ادمین',
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

      if (
        action === AdminEscrowAction.REFUND_TO_BUYER &&
        order.status === OrderStatus.REJECTED_AT_HUB &&
        !(dto.returnTrackingCode ?? '').trim()
      ) {
        throw new BadRequestException('در لغو پس از رد کارشناسی، کد رهگیری برگشت به فروشنده اجباری است');
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
        await tx.walletTransaction.create({
          data: {
            wallet: { connect: { userId: order.sellerId } },
            amount: sellerRevenue,
            type: WalletTransactionType.PENALTY,
            status: WalletTransactionStatus.SUCCESS,
            referenceId: order.id,
            meta: {
              kind: 'order-escrow',
              phase: 'seller_blocked_debit',
              debitReason: 'admin-manual-refund',
              adminNote: note ?? null,
              description: 'کسر از موجودی بلوکه فروشنده به‌دلیل بازپرداخت کامل به خریدار',
            },
          },
        });
      }
      const isInspectionReturnFlow = order.status === OrderStatus.REJECTED_AT_HUB;
      const buyerRefundAmount = isInspectionReturnFlow
        ? refundableToBuyerAfterReturn
        : totalAmount;

      if (buyerRefundAmount > 0) {
        await tx.wallet.upsert({
          where: { userId: order.buyerId },
          create: {
            userId: order.buyerId,
            balanceAvailable: buyerRefundAmount,
            balanceBlocked: 0,
          },
          update: { balanceAvailable: { increment: buyerRefundAmount } },
        });
        await tx.walletTransaction.create({
          data: {
            wallet: { connect: { userId: order.buyerId } },
            amount: buyerRefundAmount,
            type: WalletTransactionType.REFUND,
            status: WalletTransactionStatus.SUCCESS,
            referenceId: order.id,
            meta: {
              refundReason: 'admin-manual-refund',
              adminNote: note ?? null,
              ...(isInspectionReturnFlow
                ? {
                    shippingCostExcluded: shippingCost,
                    verificationFeeExcluded: verificationChargedToBuyer,
                  }
                : {}),
            },
          },
        });
      }

      const updated = await tx.order.update({
        where: { id: order.id },
        data: {
          status: OrderStatus.CANCELLED,
          cancelReason:
            order.status === OrderStatus.REJECTED_AT_HUB
              ? [
                  note ?? 'لغو پس از رد کارشناسی',
                  `کد رهگیری برگشت به فروشنده: ${(dto.returnTrackingCode ?? '').trim()}`,
                ].join('\n')
              : (note ?? 'لغو دستی توسط ادمین'),
          returnTrackingCode:
            order.status === OrderStatus.REJECTED_AT_HUB
              ? (dto.returnTrackingCode ?? '').trim()
              : order.returnTrackingCode,
          returnShippedAt:
            order.status === OrderStatus.REJECTED_AT_HUB ? new Date() : undefined,
          returnConfirmedAt:
            order.status === OrderStatus.RETURN_SHIPPED ? new Date() : undefined,
        },
      });
      await tx.listing.update({
        where: { id: order.listingId },
        data: { status: ListingStatus.APPROVED },
      });

      const cancelReasonForBuyer =
        note?.trim() ||
        (order.status === OrderStatus.REJECTED_AT_HUB
          ? 'کالا در کارشناسی هاب رد شد'
          : 'سفارش توسط ادمین لغو شد');
      const buyerTicketMessage = [
        `کاربر گرامی، سفارش «${order.listing?.title ?? 'کالا'}» لغو شد.`,
        `علت: ${cancelReasonForBuyer}`,
        `مبلغ ${buyerRefundAmount.toLocaleString('fa-IR')} تومان به کیف پول شما اضافه شد.`,
      ].join('\n');
      const buyerTicket = await tx.ticket.create({
        data: {
          userId: order.buyerId,
          subject: `لغو سفارش و بازگشت وجه [ORDER:${order.id}]`,
          status: 'ANSWERED',
          messages: {
            create: {
              senderRole: UserRole.ADMIN,
              message: buyerTicketMessage,
            },
          },
        },
        select: { id: true },
      });
      await tx.notification.create({
        data: {
          userId: order.buyerId,
          type: NotificationType.TICKET_REPLY,
          title: 'تیکت لغو سفارش ثبت شد',
          message: `برای سفارش #${order.id.slice(-6)} تیکت ثبت شد و مبلغ به کیف پول شما برگشت.`,
          meta: { orderId: order.id, ticketId: buyerTicket.id } as Prisma.InputJsonValue,
        },
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
  RETURN_REQUESTED: 'در انتظار ثبت مرجوعی خریدار',
  RETURN_SHIPPED: 'مرجوعی توسط خریدار ارسال شد',
  COMPLETED: 'تکمیل شد',
  DISPUTED: 'اختلاف',
  CANCELLED: 'لغو شد',
};
