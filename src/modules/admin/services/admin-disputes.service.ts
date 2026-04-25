import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  DisputeOutcome,
  ListingStatus,
  OrderStatus,
  Prisma,
  TicketStatus,
  UserRole,
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

const DISPUTE_INCLUDE = {
  listing: {
    select: {
      id: true,
      title: true,
      type: true,
      thumbnail: true,
      gallery: true,
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
  ) {}

  async list(
    query: AdminDisputeListQueryDto,
  ): Promise<PaginatedResult<AdminDisputeItem>> {
    const page = query.page ?? 1;
    const pageSize = query.pageSize ?? 20;
    const skip = (page - 1) * pageSize;

    const where: Prisma.OrderWhereInput = {
      OR: [
        { status: OrderStatus.DISPUTED },
        { disputeReason: { not: null } },
      ],
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
      query.sortBy === 'createdAt'
        ? { createdAt: dir }
        : { disputedAt: dir };

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
   *  - REFUND_BUYER: کل totalAmount به خریدار برگردد، سفارش CANCELLED
   *  - RELEASE_SELLER: مثل تایید نهایی خریدار، sellerRevenue آزاد شود و سفارش COMPLETED
   *  - PARTIAL_REFUND: refundToBuyer به خریدار برگردد، باقی‌مانده با کسر کارمزد به فروشنده، CANCELLED
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

      const total = Number(order.totalAmount);
      const sellerRevenue = Number(order.sellerRevenue);

      switch (dto.outcome) {
        case DisputeOutcome.REFUND_BUYER: {
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
          if (total > 0) {
            await tx.wallet.upsert({
              where: { userId: order.buyerId },
              create: {
                userId: order.buyerId,
                balanceAvailable: total,
                balanceBlocked: 0,
              },
              update: { balanceAvailable: { increment: total } },
            });
          }
          await tx.user.update({
            where: { id: order.sellerId },
            data: { trustScore: { decrement: 20 } },
          });
          await tx.order.update({
            where: { id },
            data: { status: OrderStatus.CANCELLED },
          });
          await tx.listing.update({
            where: { id: order.listingId },
            data: { status: ListingStatus.APPROVED },
          });
          break;
        }
        case DisputeOutcome.RELEASE_SELLER: {
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
          }
          await tx.user.update({
            where: { id: order.buyerId },
            data: { trustScore: { decrement: 5 } },
          });
          await tx.order.update({
            where: { id },
            data: { status: OrderStatus.COMPLETED },
          });
          break;
        }
        case DisputeOutcome.PARTIAL_REFUND: {
          const refund = Math.max(0, Math.min(total, dto.refundToBuyer ?? 0));
          if (refund > 0) {
            await tx.wallet.upsert({
              where: { userId: order.buyerId },
              create: {
                userId: order.buyerId,
                balanceAvailable: refund,
                balanceBlocked: 0,
              },
              update: { balanceAvailable: { increment: refund } },
            });
          }
          const remainForSeller = Math.max(0, sellerRevenue - refund);
          if (remainForSeller > 0) {
            await tx.wallet.upsert({
              where: { userId: order.sellerId },
              create: {
                userId: order.sellerId,
                balanceAvailable: remainForSeller,
                balanceBlocked: 0,
              },
              update: {
                balanceBlocked: { decrement: remainForSeller },
                balanceAvailable: { increment: remainForSeller },
              },
            });
          }
          await tx.order.update({
            where: { id },
            data: { status: OrderStatus.CANCELLED },
          });
          await tx.listing.update({
            where: { id: order.listingId },
            data: { status: ListingStatus.APPROVED },
          });
          break;
        }
        case DisputeOutcome.CANCEL: {
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
          if (total > 0) {
            await tx.wallet.upsert({
              where: { userId: order.buyerId },
              create: {
                userId: order.buyerId,
                balanceAvailable: total,
                balanceBlocked: 0,
              },
              update: { balanceAvailable: { increment: total } },
            });
          }
          await tx.order.update({
            where: { id },
            data: { status: OrderStatus.CANCELLED },
          });
          await tx.listing.update({
            where: { id: order.listingId },
            data: { status: ListingStatus.APPROVED },
          });
          break;
        }
      }

      const resolved = await tx.order.update({
        where: { id },
        data: {
          disputeResolution: dto.resolution,
          disputeResolvedAt: new Date(),
          disputeResolvedBy: adminId,
          disputeOutcome: dto.outcome,
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
