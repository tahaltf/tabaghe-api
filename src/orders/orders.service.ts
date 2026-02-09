import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class OrdersService {
  constructor(private prisma: PrismaService) {}

  // ۱. سفارش‌های من
  async getMyOrders(userId: string) {
    return this.prisma.order.findMany({
      where: { buyerId: userId },
      include: {
        listing: { select: { title: true, thumbnail: true } },
        seller: { select: { firstName: true, lastName: true } },
      },
      orderBy: { createdAt: 'desc' },
    });
  }

  // ۲. درخواست‌های من
  async getMyRequests(userId: string) {
    // الف) پیشنهادهای معاوضه
    const exchangeOffers = await this.prisma.exchangeOffer.findMany({
      where: { offererId: userId },
      include: {
        listing: { select: { title: true, thumbnail: true, status: true } },
      },
      orderBy: { createdAt: 'desc' },
    });

    // ب) مزایده‌ها
    const rawBids = await this.prisma.auctionBid.findMany({
      where: { bidderId: userId },
      // ✅ نکته ۱: برای distinct از نام ستون دیتابیس (Scalar) استفاده می‌کنیم
      distinct: ['listingId'],
      include: {
        // ✅ نکته ۲: برای include از نام رابطه (Relation) استفاده می‌کنیم
        // احتمالا در مدل شما رابطه به نام auction تعریف شده است
        auction: {
          include: {
            listing: { select: { id: true, title: true, thumbnail: true, status: true } }
          }
        }
      },
      orderBy: { createdAt: 'desc' },
    });

    // ج) محاسبه رتبه
    const auctionBids = await Promise.all(
      rawBids.map(async (bid) => {
        const higherBidsCount = await this.prisma.auctionBid.count({
          where: {
            // ✅ نکته ۳: اینجا هم شرط روی ستون دیتابیس است
            listingId: bid.listingId,
            amount: { gt: bid.amount },
          },
        });

        return {
          ...bid,
          myRank: higherBidsCount + 1,
        };
      })
    );

    return { exchangeOffers, auctionBids };
  }
}