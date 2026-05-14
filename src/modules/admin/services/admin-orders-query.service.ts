import { Injectable, NotFoundException } from '@nestjs/common';
import {
  OrderType,
  Prisma,
  WalletTransactionStatus,
  WalletTransactionType,
} from '@prisma/client';
import { PrismaService } from '../../../infrastructure/prisma/prisma.service';
import {
  buildPaginationMeta,
  PaginatedResult,
} from '../../../shared/contracts/pagination';
import { AdminOrderListQueryDto } from '../dto/admin-query.dto';

const ORDER_LIST_INCLUDE = {
  listing: { select: { id: true, title: true, type: true, thumbnail: true } },
  buyer: {
    select: { id: true, firstName: true, lastName: true, phone: true },
  },
  seller: {
    select: { id: true, firstName: true, lastName: true, phone: true },
  },
} satisfies Prisma.OrderInclude;

export type AdminOrderItem = Prisma.OrderGetPayload<{
  include: typeof ORDER_LIST_INCLUDE;
}>;

@Injectable()
export class AdminOrdersQueryService {
  constructor(private readonly prisma: PrismaService) {}

  async list(
    query: AdminOrderListQueryDto,
  ): Promise<PaginatedResult<AdminOrderItem>> {
    const page = query.page ?? 1;
    const pageSize = query.pageSize ?? 20;
    const skip = (page - 1) * pageSize;

    const where: Prisma.OrderWhereInput = {};
    if (query.status) where.status = query.status;
    if (query.type) where.type = query.type;
    if (query.search) {
      const s = query.search.trim();
      where.OR = [
        { id: { contains: s } },
        { trackingCode: { contains: s } },
        { listing: { title: { contains: s, mode: 'insensitive' } } },
        { buyer: { phone: { contains: s } } },
        { seller: { phone: { contains: s } } },
      ];
    }

    const dir: 'asc' | 'desc' = query.sortDir === 'asc' ? 'asc' : 'desc';
    const orderBy: Prisma.OrderOrderByWithRelationInput =
      query.sortBy === 'updatedAt' ? { updatedAt: dir } : { createdAt: dir };

    const [itemsRaw, total] = await Promise.all([
      this.prisma.order.findMany({
        where,
        include: ORDER_LIST_INCLUDE,
        orderBy,
        skip,
        take: pageSize,
      }),
      this.prisma.order.count({ where }),
    ]);

    const exchangeOfferIds = [
      ...new Set(
        itemsRaw
          .filter((o) => o.type === OrderType.EXCHANGE && !!o.exchangeOfferId)
          .map((o) => o.exchangeOfferId as string),
      ),
    ];
    const offers = exchangeOfferIds.length
      ? await this.prisma.exchangeOffer.findMany({
          where: { id: { in: exchangeOfferIds } },
          select: { id: true, title: true },
        })
      : [];
    const offerTitleById = new Map(offers.map((o) => [o.id, o.title]));

    const items = itemsRaw.map((o) => ({
      ...o,
      exchangeOfferTitle:
        o.type === OrderType.EXCHANGE && o.exchangeOfferId
          ? (offerTitleById.get(o.exchangeOfferId) ?? null)
          : null,
    }));

    return {
      items: items as AdminOrderItem[],
      pagination: buildPaginationMeta(page, pageSize, total),
    };
  }

  async detail(id: string) {
    const order = await this.prisma.order.findUnique({
      where: { id },
      include: {
        listing: {
          select: {
            id: true,
            title: true,
            type: true,
            thumbnail: true,
            gallery: true,
            category: { select: { id: true, title: true } },
            direct: { select: { price: true } },
            auction: { select: { basePrice: true, highestBidAmount: true } },
          },
        },
        buyer: {
          select: {
            id: true,
            firstName: true,
            lastName: true,
            phone: true,
            email: true,
            nationalCode: true,
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
            shabaNumber: true,
            avatar: true,
          },
        },
        reviews: true,
      },
    });
    if (!order) throw new NotFoundException('سفارش یافت نشد');

    let exchangeOfferDetails: {
      extraPayment: number;
      isPayerMe: boolean;
    } | null = null;
    let exchangeOffer: { title?: string | null } | null = null;
    if (order.type === OrderType.EXCHANGE && order.exchangeOfferId) {
      const offer = await this.prisma.exchangeOffer.findUnique({
        where: { id: order.exchangeOfferId },
        select: { extraPayment: true, isPayerMe: true, title: true },
      });
      if (offer) {
        exchangeOfferDetails = {
          extraPayment: Number(offer.extraPayment),
          isPayerMe: offer.isPayerMe,
        };
        exchangeOffer = {
          title: offer.title,
        };
      }
    }

    let exchangePaymentSources: {
      buyer: 'GATEWAY' | 'WALLET' | 'UNKNOWN';
      seller: 'GATEWAY' | 'WALLET' | 'UNKNOWN';
    } | null = null;
    if (order.type === OrderType.EXCHANGE) {
      const inferred: {
        buyer: 'GATEWAY' | 'WALLET' | 'UNKNOWN';
        seller: 'GATEWAY' | 'WALLET' | 'UNKNOWN';
      } = {
        buyer: 'WALLET',
        seller: 'WALLET',
      };
      const settlements = await this.prisma.walletTransaction.findMany({
        where: {
          wallet: {
            userId: { in: [order.buyerId, order.sellerId] },
          },
          AND: [
            { type: WalletTransactionType.SETTLEMENT },
            { status: WalletTransactionStatus.SUCCESS },
            { meta: { path: ['kind'], equals: 'order-escrow' } },
            {
              OR: [
                { meta: { path: ['orderId'], equals: order.id } },
                { meta: { path: ['listingId'], equals: order.listingId } },
              ],
            },
          ],
        },
        select: {
          wallet: { select: { userId: true } },
          meta: true,
        },
      });
      for (const tx of settlements) {
        const meta = (tx.meta as Record<string, unknown> | null) ?? {};
        const src = String(meta['paymentSource'] ?? '').toUpperCase();
        const mapped: 'GATEWAY' | 'WALLET' | null =
          src === 'GATEWAY' ? 'GATEWAY' : src === 'WALLET' ? 'WALLET' : null;
        if (!mapped) continue;
        if (tx.wallet.userId === order.buyerId) inferred.buyer = mapped;
        if (tx.wallet.userId === order.sellerId) inferred.seller = mapped;
      }
      exchangePaymentSources = inferred;
    }

    return {
      ...order,
      exchangeOfferDetails,
      exchangeOffer,
      exchangePaymentSources,
    };
  }
}
