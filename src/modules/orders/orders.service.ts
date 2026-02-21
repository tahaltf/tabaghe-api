import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../../infrastructure/prisma/prisma.service'; // مسیر را در صورت نیاز اصلاح کنید
import { ListingType, OrderStatus, OrderType } from '@prisma/client';
import { Cron, CronExpression } from '@nestjs/schedule';
import { WalletService } from "../wallet/wallet.service";
import { FeeCalculatorService } from '../fees/fee-calculator.service'; // 👈 ایمپورت موتور کارمزد اضافه شد
import Decimal from 'decimal.js';

@Injectable()
export class OrdersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly walletService: WalletService,
    private readonly feeCalculator: FeeCalculatorService, // 👈 تزریق موتور کارمزد اضافه شد
  ) {}

  // =================================================================
  // 1. FETCH ORDERS BY TYPE (خرید یا فروش) - استفاده شده در تب‌های جدید ✅
  // =================================================================
  async getOrdersByType(userId: string, type: 'BUY' | 'SELL') {
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
            status: true,
            type: true,
          },
        },
        seller:
          type === 'BUY'
            ? {
              select: { firstName: true, lastName: true, avatar: true },
            }
            : undefined,
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
    const exchangeOffers = await this.prisma.exchangeOffer.findMany({
      where: { offererId: userId },
      include: {
        listing: {
          select: { id: true, title: true, thumbnail: true, status: true }
        },
      },
      orderBy: { createdAt: 'desc' },
    });

    const rawBids = await this.prisma.auctionBid.findMany({
      where: { bidderId: userId },
      distinct: ['listingId'],
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
      }),
    );

    return { exchangeOffers, auctionBids };
  }

  // =================================================================
  // 3. COMPLETE EXCHANGE ORDER (تکمیل خرید معاوضه) - جدید و ایمن ✅
  // =================================================================
  async completeExchangeOrder(userId: string, offerId: string) {
    return this.prisma.$transaction(async (tx) => {
      const offer = await tx.exchangeOffer.findUnique({
        where: { id: offerId },
        include: { listing: true },
      });

      if (!offer) throw new NotFoundException('پیشنهاد یافت نشد');
      if (offer.offererId !== userId)
        throw new ForbiddenException('شما صاحب این پیشنهاد نیستید');
      if (offer.status !== 'ACCEPTED')
        throw new BadRequestException('این پیشنهاد تایید نشده است');

      if (offer.listing.status === 'SOLD') {
        throw new BadRequestException(
          'متاسفانه این کالا لحظاتی پیش توسط کاربر دیگری خریداری شد.',
        );
      }

      const extraPay = Number(offer.extraPayment);
      let sellerRevenue: number | string = 0;

      if (extraPay > 0) {
        const platformFee = await this.feeCalculator.calculateFee(
          ListingType.EXCHANGE,
          offer.listing.categoryId,
          extraPay
        );

        sellerRevenue = new Decimal(extraPay).minus(platformFee).toString();

        await this.walletService.transferToEscrow(
          userId,
          offer.listing.authorId,
          extraPay,
          platformFee,
          offer.listingId,
          tx,
        );
      }

      const order = await tx.order.create({
        data: {
          buyer: { connect: { id: userId } },
          seller: { connect: { id: offer.listing.authorId } },
          listing: { connect: { id: offer.listingId } },
          type: OrderType.EXCHANGE,
          finalPrice: extraPay > 0 ? extraPay : 0,
          sellerRevenue: sellerRevenue,
          status: extraPay > 0 ? OrderStatus.PAID : OrderStatus.DELIVERED,
        },
      });

      await tx.listing.update({
        where: { id: offer.listingId },
        data: { status: 'SOLD' },
      });

      return order;
    });
  }

  // =================================================================
  // 4. CREATE DIRECT ORDER (خرید مستقیم) - بدون تغییر ساختار
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

      const platformFee = await this.feeCalculator.calculateFee(
        ListingType.DIRECT,
        listing.categoryId,
        price
      );

      const sellerRevenue = new Decimal(price).minus(platformFee).toString();

      await this.walletService.transferToEscrow(
        buyerId,
        listing.authorId,
        price,
        platformFee,
        listingId,
        tx,
      );

      const order = await tx.order.create({
        data: {
          buyer: { connect: { id: buyerId } },
          seller: { connect: { id: listing.authorId } },
          listing: { connect: { id: listingId } },
          type: OrderType.DIRECT,
          finalPrice: price,
          sellerRevenue: sellerRevenue,
          status: OrderStatus.PAID,
        },
      });

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
        });
      } catch (error) {
        console.error(`Failed to auto-confirm order ${order.id}`, error);
      }
    }
  }

  // =================================================================
  // 8. متد جامع ثبت سفارش
  // =================================================================
  async handleUniversalOrder(userId: string, dto: any) {
    const { addressId, paymentMethod, orderType, exchangeRequestId } = dto;
    let listingId = dto.listingId;
    let paymentUrl = null;

    const order = await this.prisma.$transaction(async (tx) => {
      let finalPrice = 0;
      let sellerId = '';
      let buyerId = userId;
      let categoryId = '';

      if (orderType === 'EXCHANGE') {
        const offer = await tx.exchangeOffer.findUnique({
          where: { id: exchangeRequestId },
          include: { listing: { include: { direct: true } } }
        });
        if (!offer || offer.status !== 'ACCEPTED') throw new BadRequestException('درخواست معاوضه معتبر نیست');

        listingId = offer.listingId;
        categoryId = offer.listing.categoryId;

        if (userId === offer.offererId) {
          finalPrice = offer.isPayerMe ? Number(offer.extraPayment) : 0;
          sellerId = offer.listing.authorId;
        } else if (userId === offer.listing.authorId) {
          finalPrice = !offer.isPayerMe ? Number(offer.extraPayment) : 0;
          sellerId = offer.offererId;
        } else {
          throw new ForbiddenException('شما طرفین این معامله نیستید');
        }

      } else if (orderType === 'AUCTION') {
        const listing = await tx.listing.findUnique({
          where: { id: listingId },
          include: { auction: { include: { bids: { where: { bidderId: userId }, orderBy: { amount: 'desc' }, take: 1 } } } }
        });
        if (!listing || !listing.auction || !listing.auction.bids[0]) throw new BadRequestException('اطلاعات مزایده یافت نشد');

        const userBid = Number(listing.auction.bids[0].amount);
        const guaranteeBlocked = userBid * 0.10;
        finalPrice = userBid - guaranteeBlocked;
        sellerId = listing.authorId;
        categoryId = listing.categoryId;
        if (sellerId === userId) throw new ForbiddenException('شما نمی‌توانید آگهی خودتان را سفارش دهید.');

      } else {
        const listing = await tx.listing.findUnique({
          where: { id: listingId },
          include: { direct: true }
        });
        if (!listing || listing.status !== 'APPROVED') throw new BadRequestException('آگهی یافت نشد یا فروخته شده');

        finalPrice = Number(listing.direct?.price || 0);
        sellerId = listing.authorId;
        categoryId = listing.categoryId;
        if (sellerId === userId) throw new ForbiddenException('شما نمی‌توانید آگهی خودتان را سفارش دهید.');
      }

      if (!listingId) throw new BadRequestException('آیدی آگهی یافت نشد.');

      const existingOrder = await tx.order.findFirst({
        where: { listingId: listingId }
      });

      if (existingOrder) {
        if (existingOrder.status !== OrderStatus.PENDING) {
          throw new BadRequestException('این آگهی قبلاً به فروش رسیده است.');
        }
        await tx.order.delete({ where: { id: existingOrder.id } });
      }

      const platformFee = await this.feeCalculator.calculateFee(
        orderType === 'AUCTION' ? ListingType.AUCTION : (orderType === 'EXCHANGE' ? ListingType.EXCHANGE : ListingType.DIRECT),
        categoryId,
        finalPrice
      );
      const sellerRevenue = new Decimal(finalPrice).minus(platformFee).toString();

      if (paymentMethod === 'WALLET' && finalPrice > 0) {
        const wallet = await tx.wallet.findUnique({ where: { userId } });
        if (!wallet || Number(wallet.balanceAvailable) < finalPrice) {
          throw new BadRequestException('موجودی کیف پول شما کافی نیست');
        }
        await this.walletService.transferToEscrow(buyerId, sellerId, finalPrice, platformFee, listingId, tx);
      }

      let orderStatus: OrderStatus = OrderStatus.PENDING;
      if (paymentMethod === 'WALLET' || finalPrice === 0) {
        orderStatus = OrderStatus.PAID;
      }

      const orderPayload: any = {
        buyer: { connect: { id: buyerId } },
        seller: { connect: { id: sellerId } },
        listing: { connect: { id: listingId } },
        type: orderType as any,
        finalPrice: finalPrice,
        sellerRevenue: sellerRevenue,
        platformFee: platformFee,
        status: orderStatus,
      };

      if (exchangeRequestId) orderPayload.exchangeOfferId = exchangeRequestId;

      if (addressId) {
        const fetchedAddress = await tx.address.findUnique({ where: { id: addressId } });
        if (fetchedAddress) {
          orderPayload.shippingAddress = `${fetchedAddress.province}، ${fetchedAddress.city}، ${fetchedAddress.fullAddress}`;
          orderPayload.shippingPhone = fetchedAddress.phone;
          orderPayload.shippingPostalCode = fetchedAddress.postalCode;
        }
      }

      const createdOrder = await tx.order.create({ data: orderPayload });

      if (orderStatus === OrderStatus.PAID) {
        await tx.listing.update({ where: { id: listingId }, data: { status: 'SOLD' } });
      }

      return createdOrder;
    });

    if (paymentMethod === 'GATEWAY' && Number(order.finalPrice) > 0) {
      paymentUrl = `https://sandbox.zarinpal.com/pg/StartPay/mock-token-for-order-${order.id}`;
    }

    return {
      ...order,
      paymentUrl: paymentUrl
    };
  }

  // =================================================================
  // 9. متد جدید: ثبت کد رهگیری پستی توسط فروشنده
  // =================================================================
// =================================================================
  // 9. ثبت کد رهگیری (هوشمند و دوطرفه برای معاوضه)
  // =================================================================
  async updateTrackingCode(userId: string, orderId: string, trackingCode: string) {
    // ۱. ولیدیشن سخت‌گیرانه ۲۴ رقم عدد
    if (!/^\d{24}$/.test(trackingCode)) {
      throw new BadRequestException('کد رهگیری باید دقیقاً ۲۴ رقم و فقط شامل اعداد باشد.');
    }

    const order = await this.prisma.order.findUnique({
      where: { id: orderId }
    });

    if (!order) throw new NotFoundException('سفارش یافت نشد');
    if (order.status !== OrderStatus.PAID && order.status !== OrderStatus.SHIPPED) {
      throw new BadRequestException('فقط برای سفارش‌های پرداخت شده امکان ثبت کد رهگیری وجود دارد');
    }

    const isOriginalSeller = order.sellerId === userId;
    const isExchangeBuyer = order.type === OrderType.EXCHANGE && order.buyerId === userId;

    if (!isOriginalSeller && !isExchangeBuyer) {
      throw new ForbiddenException('شما مجاز به ثبت کد رهگیری برای این سفارش نیستید');
    }

    // ۲. به‌روزرسانی فیلد مربوطه بر اساس نقش کاربر
    const updateData: any = {};

    if (isOriginalSeller) {
      updateData.trackingCode = trackingCode;
    } else if (isExchangeBuyer) {
      updateData.sellerTrackingCode = trackingCode;
    }

    // ۳. تغییر وضعیت سفارش به SHIPPED (فقط اگر هر دو کد در معاوضه ثبت شده باشند یا در فروش مستقیم کد اول ثبت شود)
    // فعلاً با ثبت هر کدام وضعیت را SHIPPED می‌کنیم، اما در فرانت هر دو را نشان می‌دهیم
    updateData.status = OrderStatus.SHIPPED;

    return this.prisma.order.update({
      where: { id: orderId },
      data: updateData
    });
  }
// =================================================================
  // متد نهایی کردن معاوضه توسط صاحب آگهی (فروشنده)
  // =================================================================
  async finalizeExchange(sellerId: string, offerId: string, sellerAddressId: string) {
    return this.prisma.$transaction(async (tx) => {
      // ۱. پیدا کردن پیشنهاد و آگهی
      const offer = await tx.exchangeOffer.findUnique({
        where: { id: offerId },
        include: { listing: true }
      });

      if (!offer || offer.listing.authorId !== sellerId) {
        throw new NotFoundException('پیشنهاد یافت نشد یا دسترسی غیرمجاز است');
      }

      // ۲. گرفتن آدرس منتخب فروشنده
      const address = await tx.address.findUnique({ where: { id: sellerAddressId } });
      if (!address) throw new BadRequestException('آدرس فروشنده انتخاب نشده است');

      const sellerAddrStr = `${address.province}، ${address.city}، ${address.fullAddress}`;

      // ۳. ایجاد سفارش (Order)
      // توجه: در اینجا خریدار (Buyer) همان پیشنهاددهنده (offererId) است
      const order = await tx.order.create({
        data: {
          listingId: offer.listingId,
          buyerId: offer.offererId,
          sellerId: sellerId,
          type: OrderType.EXCHANGE,
          exchangeOfferId: offer.id,
          finalPrice: offer.isPayerMe ? 0 : Number(offer.extraPayment), // اگر پرداخت با من نیست، یعنی فروشنده پول می‌گیرد
          platformFee: 0, // در فاز تست صفر
          sellerRevenue: offer.isPayerMe ? 0 : Number(offer.extraPayment),
          status: OrderStatus.PAID, // فرض بر این است که معاوضه بدون مابه‌تفاوت نقدی است یا قبلاً توافق شده

          // آدرس فروشنده (برای ارسال کالای معاوضه‌ای به او)
          sellerShippingAddress: sellerAddrStr,
          sellerShippingPhone: address.phone,
          sellerShippingPostalCode: address.postalCode,

          // آدرس خریدار (باید از قبل در پروفایلش داشته باشد یا در مرحله بعد آپدیت شود)
          // فعلاً برای تست اولین آدرس خریدار را می‌گیریم
          shippingAddress: 'در انتظار تکمیل توسط خریدار',
        }
      });

      // ۴. آپدیت وضعیت پیشنهاد و آگهی
      await tx.exchangeOffer.update({
        where: { id: offerId },
        data: { status: 'ACCEPTED' }
      });

      await tx.listing.update({
        where: { id: offer.listingId },
        data: { status: 'SOLD' }
      });

      return order;
    });
  }
}