import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { WalletService } from '../modules/wallet/wallet.service';
import { ListingType, OrderStatus, OrderType } from '@prisma/client';
import { Cron, CronExpression } from '@nestjs/schedule';

@Injectable()
export class OrdersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly walletService: WalletService
  ) {}

  // =================================================================
  // FETCH ORDERS (متدهای قبلی)
  // =================================================================

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
      distinct: ['listingId'],
      include: {
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

  // =================================================================
  // CREATE ORDER (Direct Buy with Escrow) - جدید
  // =================================================================

  async createDirectOrder(buyerId: string, listingId: string) {
    return this.prisma.$transaction(async (tx) => {
      // ۱. دریافت اطلاعات آگهی
      const listing = await tx.listing.findUnique({
        where: { id: listingId },
        include: { direct: true }
      });

      if (!listing || listing.type !== ListingType.DIRECT || !listing.direct) {
        throw new BadRequestException('این آگهی برای خرید مستقیم نیست');
      }

      if (listing.status !== 'APPROVED') {
        throw new BadRequestException('آگهی فعال نیست یا قبلاً فروخته شده');
      }

      const price = Number(listing.direct.price);

      // ۲. عملیات مالی: کسر از خریدار -> بلوکه نزد فروشنده (Escrow)
      await this.walletService.transferToEscrow(buyerId, listing.authorId, price, listingId, tx);

      // ۳. ثبت سفارش
      const order = await tx.order.create({
        data: {
          buyerId,
          sellerId: listing.authorId,
          listingId,
          type: OrderType.DIRECT,
          finalPrice: price,
          status: OrderStatus.PAID, // پرداخت شده اما پول بلوکه است
        }
      });

      // ۴. تغییر وضعیت آگهی به "فروخته شده"
      await tx.listing.update({
        where: { id: listingId },
        data: { status: 'SOLD' }
      });

      return order;
    });
  }

  // =================================================================
  // CONFIRM ORDER (آزادسازی پول) - جدید
  // =================================================================

  async confirmOrder(buyerId: string, orderId: string) {
    return this.prisma.$transaction(async (tx) => {
      const order = await tx.order.findUnique({ where: { id: orderId } });

      if (!order) throw new NotFoundException('سفارش یافت نشد');
      if (order.buyerId !== buyerId) throw new BadRequestException('شما خریدار این سفارش نیستید');
      if (order.status === OrderStatus.DELIVERED) throw new BadRequestException('این سفارش قبلاً تایید شده است');

      // آزادسازی پول برای فروشنده
      await this.walletService.releaseEscrow(order.sellerId, order.finalPrice, order.listingId, tx);

      // آپدیت وضعیت سفارش
      return tx.order.update({
        where: { id: orderId },
        data: { status: OrderStatus.DELIVERED } // DELIVERED یعنی پول آزاد شد و معامله تمام
      });
    });
  }

  // =================================================================
  // CRON: AUTO CONFIRM AFTER 24 HOURS - جدید
  // =================================================================

  @Cron(CronExpression.EVERY_HOUR) // هر یک ساعت اجرا میشود
  async autoConfirmOrders() {
    // پیدا کردن سفارش‌هایی که ۲۴ ساعت از ایجادشان گذشته و هنوز وضعیتشان PAID است (تایید نشده‌اند)
    const oneDayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);

    const expiredOrders = await this.prisma.order.findMany({
      where: {
        status: OrderStatus.PAID,
        createdAt: { lte: oneDayAgo }
      }
    });

    console.log(`Checking auto-confirm orders: Found ${expiredOrders.length}`);

    for (const order of expiredOrders) {
      try {
        await this.prisma.$transaction(async (tx) => {
          // آزادسازی پول
          await this.walletService.releaseEscrow(order.sellerId, order.finalPrice, order.listingId, tx);

          // آپدیت وضعیت
          await tx.order.update({
            where: { id: order.id },
            data: { status: OrderStatus.DELIVERED }
          });
          console.log(`Auto confirmed order ID: ${order.id}`);
        });
      } catch (error) {
        console.error(`Failed to auto-confirm order ${order.id}`, error);
      }
    }
  }
}