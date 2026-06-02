import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  DisputeOutcome,
  OrderStatus,
  Prisma,
  TicketStatus,
  UserRole,
  WalletTransactionStatus,
  WalletTransactionType,
} from '@prisma/client';
import { PrismaService } from '../../../infrastructure/prisma/prisma.service';
import {
  buildPaginationMeta,
  PaginatedResult,
} from '../../../shared/contracts/pagination';
import { NotificationService } from '../../notification/notification.service';
import {
  AdminDisputeListQueryDto,
  ResolveDisputeDto,
} from '../dto/admin-dispute.dto';
import { OrderReputationService } from '../../orders/order-reputation.service';
import { enrichOrderUpdateForCompletion } from '../../orders/order-lifecycle.util';
import { ListingCommandService } from '../../listing/services/listing-command.service';
import { WalletService } from '../../wallet/wallet.service';

const DISPUTE_INCLUDE = {
  listing: {
    select: {
      id: true,
      title: true,
      type: true,
      thumbnail: true,
      gallery: true,
      shippingPayer: true,
      category: { select: { id: true, title: true } },
    },
  },
  buyer: {
    select: {
      id: true,
      firstName: true,
      lastName: true,
      phone: true,
      email: true,
      avatar: true,
    },
  },
  seller: {
    select: {
      id: true,
      firstName: true,
      lastName: true,
      phone: true,
      email: true,
      avatar: true,
      shabaNumber: true,
    },
  },
} satisfies Prisma.OrderInclude;

export type AdminDisputeItem = Prisma.OrderGetPayload<{
  include: typeof DISPUTE_INCLUDE;
}>;

@Injectable()
export class AdminDisputesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly notification: NotificationService,
    private readonly orderReputation: OrderReputationService,
    private readonly listingCommand: ListingCommandService,
    private readonly walletService: WalletService,
  ) {}

  async list(
    query: AdminDisputeListQueryDto,
  ): Promise<PaginatedResult<AdminDisputeItem>> {
    const page = query.page ?? 1;
    const pageSize = query.pageSize ?? 20;
    const skip = (page - 1) * pageSize;

    const where: Prisma.OrderWhereInput = {
      OR: [{ status: OrderStatus.DISPUTED }, { disputeReason: { not: null } }],
    };

    if (query.resolution === 'OPEN') {
      where.status = OrderStatus.DISPUTED;
      where.disputeResolvedAt = null;
    } else if (query.resolution === 'RESOLVED') {
      where.disputeResolvedAt = { not: null };
    }

    if (query.search) {
      const s = query.search.trim();
      where.AND = [
        {
          OR: [
            { id: { contains: s } },
            { trackingCode: { contains: s } },
            { listing: { title: { contains: s, mode: 'insensitive' } } },
            { buyer: { phone: { contains: s } } },
            { seller: { phone: { contains: s } } },
          ],
        },
      ];
    }

    const dir: 'asc' | 'desc' = query.sortDir === 'asc' ? 'asc' : 'desc';
    const orderBy: Prisma.OrderOrderByWithRelationInput =
      query.sortBy === 'createdAt' ? { createdAt: dir } : { disputedAt: dir };

    const [items, total] = await Promise.all([
      this.prisma.order.findMany({
        where,
        include: DISPUTE_INCLUDE,
        orderBy,
        skip,
        take: pageSize,
      }),
      this.prisma.order.count({ where }),
    ]);

    return { items, pagination: buildPaginationMeta(page, pageSize, total) };
  }

  async detail(id: string) {
    const order = await this.prisma.order.findUnique({
      where: { id },
      include: DISPUTE_INCLUDE,
    });
    if (!order) throw new NotFoundException('سفارش یافت نشد');
    if (!order.disputeReason && order.status !== OrderStatus.DISPUTED) {
      throw new BadRequestException('این سفارش دارای شکایت نیست');
    }
    return order;
  }

  async stats() {
    const [open, resolved, totalDisputed] = await Promise.all([
      this.prisma.order.count({
        where: { status: OrderStatus.DISPUTED, disputeResolvedAt: null },
      }),
      this.prisma.order.count({
        where: { disputeResolvedAt: { not: null } },
      }),
      this.prisma.order.count({
        where: {
          OR: [
            { status: OrderStatus.DISPUTED },
            { disputeReason: { not: null } },
          ],
        },
      }),
    ]);
    return { open, resolved, totalDisputed };
  }

  /**
   * حل شکایت توسط ادمین.
   * بسته به outcome:
   *  - REFUND_BUYER: مرجوعی اجباری؛ پس از تایید تحویل مرجوعی توسط فروشنده، بازگشت وجه انجام می‌شود
   *  - RELEASE_SELLER: مثل تایید نهایی خریدار، sellerRevenue آزاد شود و سفارش COMPLETED
   *  - PARTIAL_REFUND: refundToBuyer به خریدار برگردد، باقی‌مانده برای فروشنده آزاد و سفارش COMPLETED
   *  - CANCEL: بدون انتقال مالی خاص، فقط CANCELLED
   */
  async resolve(id: string, adminId: string, dto: ResolveDisputeDto) {
    return this.prisma.$transaction(async (tx) => {
      const order = await tx.order.findUnique({ where: { id } });
      if (!order) throw new NotFoundException('سفارش یافت نشد');
      if (order.disputeResolvedAt) {
        throw new BadRequestException('این شکایت قبلاً رسیدگی شده است');
      }
      if (order.status !== OrderStatus.DISPUTED) {
        throw new BadRequestException('وضعیت سفارش برای حل شکایت مناسب نیست');
      }

      const sellerRevenue = Number(order.sellerRevenue);

      switch (dto.outcome) {
        case DisputeOutcome.REFUND_BUYER: {
          const returnAddress = (dto.returnAddress ?? '').trim();
          const returnPostalCode = (dto.returnPostalCode ?? '').trim();
          if (returnAddress.length < 10) {
            throw new BadRequestException(
              'برای مرجوعی کالا، نشانی کامل مقصد (حداقل ۱۰ نویسه) الزامی است',
            );
          }
          if (returnPostalCode.length < 5) {
            throw new BadRequestException(
              'برای مرجوعی کالا، کدپستی مقصد الزامی است',
            );
          }
          const cancelReason = [
            'مرجوعی کالا توسط خریدار در انتظار ثبت است',
            `آدرس مقصد: ${returnAddress}`,
            `کدپستی مقصد: ${returnPostalCode}`,
          ].join('\n');
          await tx.order.update({
            where: { id },
            data: {
              status: OrderStatus.RETURN_REQUESTED,
              cancelReason,
            },
          });
          const listingRow = await tx.listing.findUnique({
            where: { id: order.listingId },
            select: { title: true },
          });
          await this.listingCommand.rejectAfterTradeFailure(tx, {
            listingId: order.listingId,
            sellerId: order.sellerId,
            listingTitle: listingRow?.title ?? 'کالا',
            rejectionReason: `مرجوعی پس از شکایت خریدار. ${dto.resolution?.trim() || cancelReason}`,
            source: 'dispute-refund',
            orderId: order.id,
          });
          break;
        }
        case DisputeOutcome.RELEASE_SELLER: {
          if (sellerRevenue > 0) {
            const toRelease = await this.walletService.resolveOrderScopedCap(tx, {
              userId: order.sellerId,
              orderId: order.id,
              listingId: order.listingId,
              requestedAmount: sellerRevenue,
            });
            if (toRelease > 0) {
              await this.walletService.releaseEscrow(
                order.sellerId,
                toRelease,
                order.listingId,
                tx,
                { orderId: order.id },
              );
            }
          }
          await this.orderReputation.applyTrustPointsPenalty(
            tx,
            [order.buyerId],
            5,
            {
              orderId: order.id,
              reason: 'جریمه شکایت به نفع فروشنده',
              source: 'dispute_release_seller',
            },
          );
          await tx.order.update({
            where: { id },
            data: enrichOrderUpdateForCompletion({
              status: OrderStatus.COMPLETED,
            }),
          });
          await this.orderReputation.recordTerminalOutcome(
            tx,
            {
              id: order.id,
              buyerId: order.buyerId,
              sellerId: order.sellerId,
              tradeReputationAt: order.tradeReputationAt,
            },
            OrderStatus.DISPUTED,
            'SUCCESS',
          );
          break;
        }
        case DisputeOutcome.PARTIAL_REFUND: {
          const refund = Math.max(
            0,
            Math.min(sellerRevenue, dto.refundToBuyer ?? 0),
          );
          if (refund > 0) {
            const buyerWallet = await tx.wallet.upsert({
              where: { userId: order.buyerId },
              create: {
                userId: order.buyerId,
                balanceAvailable: refund,
                balanceBlocked: 0,
              },
              update: { balanceAvailable: { increment: refund } },
            });
            await tx.walletTransaction.create({
              data: {
                walletId: buyerWallet.id,
                amount: refund,
                type: WalletTransactionType.REFUND,
                status: WalletTransactionStatus.SUCCESS,
                referenceId: order.listingId,
                meta: {
                  kind: 'order-dispute',
                  phase: 'partial_refund_to_buyer',
                  orderId: order.id,
                  listingId: order.listingId,
                  description:
                    'بازگشت بخشی از وجه به خریدار پس از رسیدگی به شکایت',
                },
              },
            });
            await this.walletService.debitOrderScopedBlocked(tx, {
              userId: order.sellerId,
              orderId: order.id,
              listingId: order.listingId,
              requestedAmount: refund,
              referenceId: order.listingId,
              penaltyMeta: {
                kind: 'order-dispute',
                phase: 'seller_blocked_debit',
                orderId: order.id,
                listingId: order.listingId,
                description:
                  'کسر از سهم بلوکه‌شده فروشنده بابت مصالحه جزئی شکایت',
              },
            });
          }
          const remainForSeller = Math.max(0, sellerRevenue - refund);
          if (remainForSeller > 0) {
            const toRelease = await this.walletService.resolveOrderScopedCap(tx, {
              userId: order.sellerId,
              orderId: order.id,
              listingId: order.listingId,
              requestedAmount: remainForSeller,
            });
            if (toRelease > 0) {
              await this.walletService.releaseEscrow(
                order.sellerId,
                toRelease,
                order.listingId,
                tx,
                { orderId: order.id },
              );
            }
          }
          await tx.order.update({
            where: { id },
            data: enrichOrderUpdateForCompletion({
              status: OrderStatus.COMPLETED,
            }),
          });
          await this.orderReputation.recordTerminalOutcome(
            tx,
            {
              id: order.id,
              buyerId: order.buyerId,
              sellerId: order.sellerId,
              tradeReputationAt: order.tradeReputationAt,
            },
            OrderStatus.DISPUTED,
            'SUCCESS',
          );
          break;
        }
        case DisputeOutcome.CANCEL:
          throw new BadRequestException(
            'در رسیدگی شکایت مستقیم، لغو کامل و بازگشت کامل وجه مجاز نیست. از «مرجوعی کالا» یا «بازگشت جزئی» استفاده کنید.',
          );
      }

      const disputePartialRefundToBuyer =
        dto.outcome === DisputeOutcome.PARTIAL_REFUND
          ? Math.max(0, Math.min(sellerRevenue, dto.refundToBuyer ?? 0))
          : null;

      const resolved = await tx.order.update({
        where: { id },
        data: {
          disputeResolution: dto.resolution,
          disputeResolvedAt: new Date(),
          disputeResolvedBy: adminId,
          disputeOutcome: dto.outcome,
          disputePartialRefundToBuyer,
        },
      });

      const outcomeLabel =
        dto.outcome === DisputeOutcome.REFUND_BUYER
          ? 'بازگشت کامل وجه به خریدار'
          : dto.outcome === DisputeOutcome.RELEASE_SELLER
            ? 'آزادسازی وجه برای فروشنده'
            : dto.outcome === DisputeOutcome.PARTIAL_REFUND
              ? 'بازگشت بخشی از وجه'
              : 'لغو سفارش';
      const adminReply = [
        `نتیجه رسیدگی سفارش #${id.slice(-6)} اعلام شد.`,
        `تصمیم: ${outcomeLabel}`,
        `توضیح ادمین: ${dto.resolution}`,
      ].join('\n');

      const relatedTickets = await tx.ticket.findMany({
        where: {
          userId: { in: [order.buyerId, order.sellerId] },
          OR: [
            { subject: { contains: `[ORDER:${id}]`, mode: 'insensitive' } },
            { subject: { contains: id.slice(-6), mode: 'insensitive' } },
          ],
        },
        select: { id: true },
      });

      if (relatedTickets.length > 0) {
        await tx.ticketMessage.createMany({
          data: relatedTickets.map((t) => ({
            ticketId: t.id,
            senderRole: UserRole.ADMIN,
            message: adminReply,
          })),
        });
        await tx.ticket.updateMany({
          where: { id: { in: relatedTickets.map((t) => t.id) } },
          data: { status: TicketStatus.ANSWERED },
        });
      }

      try {
        await Promise.all([
          this.notification.create({
            userId: order.buyerId,
            type: 'ORDER_STATUS_CHANGED',
            title: 'نتیجه رسیدگی به شکایت',
            message: `شکایت سفارش #${id.slice(-6)} رسیدگی شد. ${dto.resolution}`,
            meta: { orderId: id, outcome: dto.outcome },
          }),
          this.notification.create({
            userId: order.sellerId,
            type: 'ORDER_STATUS_CHANGED',
            title: 'نتیجه رسیدگی به شکایت',
            message: `شکایت سفارش #${id.slice(-6)} رسیدگی شد. ${dto.resolution}`,
            meta: { orderId: id, outcome: dto.outcome },
          }),
        ]);
      } catch {
        // ignore notification errors
      }

      return resolved;
    });
  }
}
