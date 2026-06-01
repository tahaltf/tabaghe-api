import { Injectable } from '@nestjs/common';
import {
  OrderStatus,
  OrderType,
  Prisma,
} from '@prisma/client';
import { PrismaService } from '../../../../infrastructure/prisma/prisma.service';
import {
  resolveExchangeOfferListDisplay,
  resolveExchangeOrderListDisplay,
} from '../../exchange-offer-display.util';

@Injectable()
export class OrdersListQueryService {
  constructor(private readonly prisma: PrismaService) {}

  async getOrdersByType(
    userId: string,
    type: 'BUY' | 'SELL',
    options: { page?: number; pageSize?: number } = {},
  ) {
    const page = Math.max(1, options.page ?? 1);
    const pageSize = Math.min(50, Math.max(1, options.pageSize ?? 20));
    const skip = (page - 1) * pageSize;

    const whereClause: Prisma.OrderWhereInput =
      type === 'BUY'
        ? { buyerId: userId }
        : {
            sellerId: userId,
            NOT: {
              AND: [
                { type: { in: [OrderType.DIRECT, OrderType.AUCTION] } },
                {
                  status: {
                    in: [OrderStatus.PENDING, OrderStatus.AWAITING_PAYMENT],
                  },
                },
              ],
            },
          };

    const [items, total] = await Promise.all([
      this.prisma.order.findMany({
        where: whereClause,
        skip,
        take: pageSize,
        select: {
          id: true,
          listingId: true,
          buyerId: true,
          sellerId: true,
          exchangeOfferId: true,
          shippingAddress: true,
          sellerShippingAddress: true,
          status: true,
          type: true,
          totalAmount: true,
          verificationFee: true,
          createdAt: true,
          updatedAt: true,
          paymentMethod: true,
          requiresVerification: true,
          trackingCode: true,
          sellerTrackingCode: true,
          exchangeHubInspection: true,
          cancelReason: true,
          listing: {
            select: {
              id: true,
              title: true,
              thumbnail: true,
              status: true,
              type: true,
            },
          },
          seller:
            type === 'BUY'
              ? {
                  select: {
                    id: true,
                    firstName: true,
                    lastName: true,
                    avatar: true,
                  },
                }
              : undefined,
          buyer:
            type === 'SELL'
              ? {
                  select: {
                    id: true,
                    firstName: true,
                    lastName: true,
                    avatar: true,
                  },
                }
              : undefined,
        },
        orderBy: { createdAt: 'desc' },
      }),
      this.prisma.order.count({ where: whereClause }),
    ]);

    const exchangeOfferIds = items
      .filter((o) => o.type === OrderType.EXCHANGE && !!o.exchangeOfferId)
      .map((o) => o.exchangeOfferId as string);
    const exchangeOffers = exchangeOfferIds.length
      ? await this.prisma.exchangeOffer.findMany({
          where: { id: { in: exchangeOfferIds } },
          select: { id: true, extraPayment: true, isPayerMe: true },
        })
      : [];
    const exchangeOfferById = new Map(exchangeOffers.map((o) => [o.id, o]));

    const itemsWithExchangeMyShare = items.map((item) => {
      if (item.type === OrderType.EXCHANGE) {
        const display = resolveExchangeOrderListDisplay({
          status: item.status,
          exchangeHubInspection: item.exchangeHubInspection,
          cancelReason: item.cancelReason,
        });
        (item as { exchangeCancelKind?: string | null }).exchangeCancelKind =
          display.exchangeCancelKind;
      }
      if (item.type !== OrderType.EXCHANGE || !item.exchangeOfferId) {
        return item;
      }
      const offer = exchangeOfferById.get(item.exchangeOfferId);
      const verificationFee = Number((item as { verificationFee?: unknown }).verificationFee || 0);
      const extra = Number(offer?.extraPayment || 0);
      const isBuyer = item.buyerId === userId;
      const isSeller = item.sellerId === userId;
      let myDue = verificationFee;
      if (isBuyer && offer?.isPayerMe) myDue += extra;
      if (isSeller && offer && !offer.isPayerMe) myDue += extra;

      const myPaid = isBuyer
        ? Boolean(item.shippingAddress)
        : isSeller
          ? Boolean(item.sellerShippingAddress)
          : false;

      return {
        ...item,
        exchangeMyDueAmount: myDue,
        exchangeMyPaidAmount: myPaid ? myDue : 0,
      };
    });

    return {
      items: itemsWithExchangeMyShare,
      pagination: {
        page,
        pageSize,
        total,
        totalPages: Math.max(1, Math.ceil(total / pageSize)),
      },
    };
  }

  async getMyRequests(
    userId: string,
    options: {
      exchangePage?: number;
      auctionPage?: number;
      pageSize?: number;
    } = {},
  ) {
    const exchangePage = Math.max(1, options.exchangePage ?? 1);
    const auctionPage = Math.max(1, options.auctionPage ?? 1);
    const pageSize = Math.min(50, Math.max(1, options.pageSize ?? 20));
    const exchangeSkip = (exchangePage - 1) * pageSize;
    const auctionSkip = (auctionPage - 1) * pageSize;

    const [exchangeOffersRaw, rawBids] = await Promise.all([
      this.prisma.exchangeOffer.findMany({
        where: {
          OR: [{ offererId: userId }, { listing: { authorId: userId } }],
        },
        select: {
          id: true,
          offererId: true,
          status: true,
          title: true,
          description: true,
          images: true,
          extraPayment: true,
          isPayerMe: true,
          createdAt: true,
          listing: {
            select: {
              id: true,
              title: true,
              thumbnail: true,
              gallery: true,
              status: true,
              authorId: true,
              exchangeOffersSince: true,
            },
          },
          offerer: {
            select: {
              id: true,
              firstName: true,
              lastName: true,
              phone: true,
            },
          },
        },
        orderBy: { createdAt: 'desc' },
      }),
      this.prisma.auctionBid.findMany({
        where: { bidderId: userId },
        distinct: ['listingId'],
        skip: auctionSkip,
        take: pageSize,
        select: {
          id: true,
          amount: true,
          createdAt: true,
          listingId: true,
          auction: {
            select: {
              listingId: true,
              basePrice: true,
              highestBidAmount: true,
              endDatetime: true,
              status: true,
              listing: {
                select: {
                  id: true,
                  title: true,
                  thumbnail: true,
                  status: true,
                },
              },
            },
          },
        },
        orderBy: { createdAt: 'desc' },
      }),
    ]);

    const exchangeOffersFiltered = exchangeOffersRaw.filter((o) => {
      if (o.offererId === userId) return true;
      return (
        !o.listing.exchangeOffersSince ||
        o.createdAt >= o.listing.exchangeOffersSince
      );
    });
    const exchangeTotal = exchangeOffersFiltered.length;
    const exchangeOffers = exchangeOffersFiltered.slice(
      exchangeSkip,
      exchangeSkip + pageSize,
    );

    const offerIds = exchangeOffers.map((o) => o.id);
    const linkedOrders = offerIds.length
      ? await this.prisma.order.findMany({
          where: { exchangeOfferId: { in: offerIds } },
          select: {
            id: true,
            exchangeOfferId: true,
            shippingAddress: true,
            sellerShippingAddress: true,
            status: true,
            exchangeHubInspection: true,
            cancelReason: true,
          },
        })
      : [];
    const orderByOfferId = new Map(
      linkedOrders.map((o) => [o.exchangeOfferId, o]),
    );
    const exchangeOffersWithPaymentState = exchangeOffers.map((offer) => {
      const linked = orderByOfferId.get(offer.id);
      const isOfferer = offer.offererId === userId;
      const mySharePaid = isOfferer
        ? Boolean(linked?.shippingAddress)
        : Boolean(linked?.sellerShippingAddress);
      const display = resolveExchangeOfferListDisplay(offer.status, linked);
      return {
        ...offer,
        status: display.status,
        exchangeCancelKind: display.exchangeCancelKind,
        isOfferer,
        exchangeOrderId: linked?.id ?? null,
        exchangeOrderStatus: linked?.status ?? null,
        mySharePaid,
      };
    });

    const auctionBids = await Promise.all(
      rawBids.map(async (bid) => {
        const higherBidsCount = await this.prisma.auctionBid.count({
          where: {
            listingId: bid.listingId,
            amount: { gt: bid.amount },
          },
        });
        return { ...bid, myRank: higherBidsCount + 1 };
      }),
    );

    const auctionListingIds = await this.prisma.auctionBid.findMany({
      where: { bidderId: userId },
      distinct: ['listingId'],
      select: { listingId: true },
    });
    const auctionTotal = auctionListingIds.length;

    return {
      exchangeOffers: exchangeOffersWithPaymentState,
      auctionBids,
      pagination: {
        exchange: {
          page: exchangePage,
          pageSize,
          total: exchangeTotal,
          totalPages: Math.max(1, Math.ceil(exchangeTotal / pageSize)),
        },
        auction: {
          page: auctionPage,
          pageSize,
          total: auctionTotal,
          totalPages: Math.max(1, Math.ceil(auctionTotal / pageSize)),
        },
      },
    };
  }
}
