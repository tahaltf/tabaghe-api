import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service'; // مسیر را در صورت نیاز اصلاح کنید
import { ListingType, OrderStatus, OrderType } from '@prisma/client';
import { Cron, CronExpression } from '@nestjs/schedule';
import { WalletService } from "../modules/wallet/wallet.service";

@Injectable()
export class OrdersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly walletService: WalletService,
  ) {}

  // =================================================================
  // 1. FETCH ORDERS BY TYPE (خرید یا فروش) - استفاده شده در تب‌های جدید ✅
  // =================================================================
  async getOrdersByType(userId: string, type: 'BUY' | 'SELL') {
    // اگر نوع BUY باشد، دنبال سفارش‌هایی می‌گردیم که کاربر خریدار است
    // اگر نوع SELL باشد، دنبال سفارش‌هایی می‌گردیم که کاربر فروشنده است
    const whereClause =
      type === 'BUY' ? { buyerId: userId } : { sellerId: userId };

    return this.prisma.order.findMany({
      where: whereClause,
      include: {
        listing: {
          select: {
            id: true,
            title: true,
            thumbnail: true,
            status: true, // وضعیت آگهی (SOLD/ACTIVE) برای نمایش لیبل‌ها مهم است
            type: true,
          },
        },
        // اگر سفارش خرید است، اطلاعات فروشنده را برگردان
        seller:
          type === 'BUY'
            ? {
              select: { firstName: true, lastName: true, avatar: true },
            }
            : undefined,

        // اگر سفارش فروش است، اطلاعات خریدار را برگردان
        buyer:
          type === 'SELL'
            ? {
              select: { firstName: true, lastName: true, avatar: true },
            }
            : undefined,
      },
      orderBy: { createdAt: 'desc' },
    });
  }

  // =================================================================
  // 2. FETCH REQUESTS (درخواست‌های معاوضه و مزایده) ✅
  // =================================================================
  async getMyRequests(userId: string) {
    // الف) پیشنهادهای معاوضه که کاربر داده است
    const exchangeOffers = await this.prisma.exchangeOffer.findMany({
      where: { offererId: userId },
      include: {
        listing: {
          select: { id: true, title: true, thumbnail: true, status: true }
        },
      },
      orderBy: { createdAt: 'desc' },
    });

    // ب) مزایده‌هایی که کاربر در آن‌ها شرکت کرده
    const rawBids = await this.prisma.auctionBid.findMany({
      where: { bidderId: userId },
      distinct: ['listingId'], // فقط آخرین وضعیت هر آگهی را برمی‌گرداند
      include: {
        auction: {
          include: {
            listing: {
              select: { id: true, title: true, thumbnail: true, status: true },
            },
          },
        },
      },
      orderBy: { createdAt: 'desc' },
    });

    // ج) محاسبه رتبه کاربر در هر مزایده
    const auctionBids = await Promise.all(
      rawBids.map(async (bid) => {
        // شمردن تعداد پیشنهادهای بالاتر از پیشنهاد من برای همان آگهی
        const higherBidsCount = await this.prisma.auctionBid.count({
          where: {
            listingId: bid.listingId,
            amount: { gt: bid.amount },
          },
        });

        return {
          ...bid,
          myRank: higherBidsCount + 1, // رتبه = تعداد بالاتر + ۱
        };
      }),
    );

    return { exchangeOffers, auctionBids };
  }

  // =================================================================
  // 3. COMPLETE EXCHANGE ORDER (تکمیل خرید معاوضه) - جدید و ایمن ✅
  // =================================================================
  async completeExchangeOrder(userId: string, offerId: string) {
    return this.prisma.$transaction(async (tx) => {
      // ۱. پیدا کردن پیشنهاد و آگهی مربوطه
      const offer = await tx.exchangeOffer.findUnique({
        where: { id: offerId },
        include: { listing: true },
      });

      if (!offer) throw new NotFoundException('پیشنهاد یافت نشد');
      if (offer.offererId !== userId)
        throw new ForbiddenException('شما صاحب این پیشنهاد نیستید');
      if (offer.status !== 'ACCEPTED')
        throw new BadRequestException('این پیشنهاد تایید نشده است');

      // ۲. بررسی حیاتی (Race Condition Check) 🚨
      // اگر آگهی قبلاً فروخته شده باشد (توسط یک پیشنهاد تایید شده دیگر)، خطا می‌دهیم
      if (offer.listing.status === 'SOLD') {
        throw new BadRequestException(
          'متاسفانه این کالا لحظاتی پیش توسط کاربر دیگری خریداری شد.',
        );
      }

      // ۳. مدیریت مالی (اگر مبلغ سرک وجود دارد)
      const extraPay = Number(offer.extraPayment); // ممکن است 0 باشد

      // اگر مبلغ مثبت باشد یعنی پیشنهاد دهنده (خریدار) باید به صاحب آگهی پول بدهد
      if (extraPay > 0) {
        await this.walletService.transferToEscrow(
          userId,
          offer.listing.authorId,
          extraPay,
          offer.listingId,
          tx,
        );
      }

      // ۴. ایجاد سفارش نهایی
      const order = await tx.order.create({
        data: {
          buyerId: userId,
          sellerId: offer.listing.authorId,
          listingId: offer.listingId,
          type: OrderType.EXCHANGE,
          finalPrice: extraPay > 0 ? extraPay : 0,
          status: extraPay > 0 ? OrderStatus.PAID : OrderStatus.DELIVERED,
          // نکته: اگر پولی رد و بدل نشود، سفارش عملاً تکمیل شده است یا منتظر ارسال است
        },
      });

      // ۵. بستن آگهی (تغییر وضعیت به فروخته شده)
      await tx.listing.update({
        where: { id: offer.listingId },
        data: { status: 'SOLD' },
      });

      return order;
    });
  }

  // =================================================================
  // 4. CREATE DIRECT ORDER (خرید مستقیم) - بدون تغییر
  // =================================================================
  async createDirectOrder(buyerId: string, listingId: string) {
    return this.prisma.$transaction(async (tx) => {
      const listing = await tx.listing.findUnique({
        where: { id: listingId },
        include: { direct: true },
      });

      if (!listing || listing.type !== ListingType.DIRECT || !listing.direct) {
        throw new BadRequestException('این آگهی برای خرید مستقیم نیست');
      }

      if (listing.status !== 'APPROVED') {
        throw new BadRequestException('آگهی فعال نیست یا قبلاً فروخته شده');
      }

      const price = Number(listing.direct.price);

      // انتقال پول به حساب واسط
      await this.walletService.transferToEscrow(
        buyerId,
        listing.authorId,
        price,
        listingId,
        tx,
      );

      // ایجاد سفارش
      const order = await tx.order.create({
        data: {
          buyerId,
          sellerId: listing.authorId,
          listingId,
          type: OrderType.DIRECT,
          finalPrice: price,
          status: OrderStatus.PAID,
        },
      });

      // تغییر وضعیت آگهی به فروش رفته
      await tx.listing.update({
        where: { id: listingId },
        data: { status: 'SOLD' },
      });

      return order;
    });
  }

  // =================================================================
  // 5. CONFIRM ORDER (آزادسازی پول توسط خریدار) - بدون تغییر
  // =================================================================
  async confirmOrder(buyerId: string, orderId: string) {
    return this.prisma.$transaction(async (tx) => {
      const order = await tx.order.findUnique({ where: { id: orderId } });

      if (!order) throw new NotFoundException('سفارش یافت نشد');
      if (order.buyerId !== buyerId)
        throw new BadRequestException('شما خریدار این سفارش نیستید');
      if (order.status === OrderStatus.DELIVERED)
        throw new BadRequestException('این سفارش قبلاً تایید شده است');

      // آزادسازی پول از حساب واسط به حساب فروشنده
      await this.walletService.releaseEscrow(
        order.sellerId,
        order.finalPrice,
        order.listingId,
        tx,
      );

      return tx.order.update({
        where: { id: orderId },
        data: { status: OrderStatus.DELIVERED },
      });
    });
  }

  // =================================================================
  // 6. LEGACY / OLD METHODS (برای اطمینان از عدم شکستن کدهای قدیمی)
  // =================================================================
  async getMyOrders(userId: string) {
    // این متد همان کار getOrdersByType با ورودی BUY را انجام می‌دهد
    // اما برای اطمینان نگهش داشتیم
    return this.getOrdersByType(userId, 'BUY');
  }

  // =================================================================
  // 7. CRON JOBS (تایید خودکار بعد از 24 ساعت) - بدون تغییر
  // =================================================================
  @Cron(CronExpression.EVERY_HOUR)
  async autoConfirmOrders() {
    const oneDayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);

    const expiredOrders = await this.prisma.order.findMany({
      where: {
        status: OrderStatus.PAID,
        createdAt: { lte: oneDayAgo },
      },
    });

    if (expiredOrders.length > 0) {
      console.log(`Checking auto-confirm orders: Found ${expiredOrders.length}`);
    }

    for (const order of expiredOrders) {
      try {
        await this.prisma.$transaction(async (tx) => {
          await this.walletService.releaseEscrow(
            order.sellerId,
            order.finalPrice,
            order.listingId,
            tx,
          );

          await tx.order.update({
            where: { id: order.id },
            data: { status: OrderStatus.DELIVERED },
          });
          console.log(`Auto confirmed order ID: ${order.id}`);
        });
      } catch (error) {
        console.error(`Failed to auto-confirm order ${order.id}`, error);
      }
    }
  }
}