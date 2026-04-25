import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import {
  AuctionBidStatus,
  AuctionSettlementStatus,
  AuctionStatus,
  ListingType,
  OrderStatus,
  OrderType,
  ListingStatus,
  Prisma,
  WalletTransactionStatus,
  WalletTransactionType,
} from '@prisma/client';
import { Cron, CronExpression } from '@nestjs/schedule';
import { WalletService } from "../wallet/wallet.service";
import { FeeCalculatorService } from '../fees/fee-calculator.service';
import Decimal from 'decimal.js';
import { OrdersStateMachineService } from './orders-state-machine.service';
import { AppSettingsService } from '../../shared/settings/app-settings.service';
import { PaymentsService } from '../payments/payments.service';

@Injectable()
export class OrdersService {
  private static readonly DEFAULT_SELLER_SHIP_DEADLINE_DAYS = 3;
  private static readonly DEFAULT_BUYER_CONFIRM_DEADLINE_DAYS = 4;
  private static readonly DEFAULT_EXCHANGE_NO_SHIPMENT_COMPENSATION = 0;

  constructor(
    private readonly prisma: PrismaService,
    private readonly walletService: WalletService,
    private readonly feeCalculator: FeeCalculatorService,
    private readonly appSettings: AppSettingsService,
    private readonly stateMachine: OrdersStateMachineService,
    private readonly paymentsService: PaymentsService,
  ) {}

  // =================================================================
  // 1. دریافت سفارش‌ها
  // =================================================================
  async getOrdersByType(
    userId: string,
    type: 'BUY' | 'SELL',
    options: { page?: number; pageSize?: number } = {},
  ) {
    const page = Math.max(1, options.page ?? 1);
    const pageSize = Math.min(50, Math.max(1, options.pageSize ?? 20));
    const skip = (page - 1) * pageSize;

    const whereClause =
      type === 'BUY' ? { buyerId: userId } : { sellerId: userId };

    const [items, total] = await this.prisma.$transaction([
      this.prisma.order.findMany({
        where: whereClause,
        skip,
        take: pageSize,
        select: {
          id: true,
          status: true,
          type: true,
          totalAmount: true,
          createdAt: true,
          updatedAt: true,
          paymentMethod: true,
          requiresVerification: true,
          trackingCode: true,
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
              ? { select: { id: true, firstName: true, lastName: true, avatar: true } }
              : undefined,
          buyer:
            type === 'SELL'
              ? { select: { id: true, firstName: true, lastName: true, avatar: true } }
              : undefined,
        },
        orderBy: { createdAt: 'desc' },
      }),
      this.prisma.order.count({ where: whereClause }),
    ]);

    return {
      items,
      pagination: {
        page,
        pageSize,
        total,
        totalPages: Math.max(1, Math.ceil(total / pageSize)),
      },
    };
  }

  // =================================================================
  // 2. دریافت درخواست‌ها
  // =================================================================
  async getMyRequests(
    userId: string,
    options: { page?: number; pageSize?: number } = {},
  ) {
    const page = Math.max(1, options.page ?? 1);
    const pageSize = Math.min(50, Math.max(1, options.pageSize ?? 20));
    const skip = (page - 1) * pageSize;

    const [exchangeOffers, rawBids] = await Promise.all([
      this.prisma.exchangeOffer.findMany({
        where: { offererId: userId },
        skip,
        take: pageSize,
        select: {
          id: true,
          status: true,
          title: true,
          description: true,
          images: true,
          extraPayment: true,
          isPayerMe: true,
          createdAt: true,
          listing: {
            select: { id: true, title: true, thumbnail: true, status: true },
          },
        },
        orderBy: { createdAt: 'desc' },
      }),
      this.prisma.auctionBid.findMany({
        where: { bidderId: userId },
        distinct: ['listingId'],
        skip,
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
                select: { id: true, title: true, thumbnail: true, status: true },
              },
            },
          },
        },
        orderBy: { createdAt: 'desc' },
      }),
    ]);

    // رتبه‌ی دقیق کاربر در هر مزایده. محدود به pageSize (≤50) پس تعداد
    // کوئری قابل کنترله و مشکل مقیاس‌پذیری ندارد.
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

    return { exchangeOffers, auctionBids };
  }

  // =================================================================
  // 3. متد اصلی ثبت سفارش (نام اصلاح شد به handleUniversalOrder) ✅
  // =================================================================
  async handleUniversalOrder(userId: string, dto: any) {
    const {
      addressId,
      paymentMethod,
      orderType,
      exchangeOfferId,
      exchangeRequestId,
      requiresVerification
    } = dto;

    const finalExchangeId = exchangeOfferId || exchangeRequestId;
    let listingId = dto.listingId;
    let paymentUrl = null;

    const order = await this.prisma.$transaction(async (tx) => {
      let finalPrice = 0;
      let shippingCost = 0;
      let sellerId = '';
      let buyerId = userId;
      let categoryId = '';
      let verificationFee = 0;
      let platformAddress = null;
      let sellerRequestedVerification = false;
      let auctionBlockedDeposit = 0;
      let auctionWinnerBidId: string | null = null;

      const feeSetting = await tx.systemSetting.findUnique({ where: { key: 'VERIFICATION_FEE' } });
      const shippingSetting = await tx.systemSetting.findUnique({ where: { key: 'SHIPPING_COST' } });
      const sellerShipDeadlineSetting = await tx.systemSetting.findUnique({
        where: { key: 'SELLER_SHIP_DEADLINE_DAYS' },
      });
      const addressSetting = await tx.systemSetting.findUnique({ where: { key: 'PLATFORM_ADDRESS' } });
      const hubAddress = addressSetting ? addressSetting.value : 'تهران، دفتر مرکزی پردازش و کارشناسی طبقه';
      const hubFee = feeSetting ? Number(feeSetting.value) : 250000;
      const shippingFee = shippingSetting ? Number(shippingSetting.value) : 50000;
      const sellerShipDeadlineDays = this.parsePositiveIntSetting(
        sellerShipDeadlineSetting?.value,
        OrdersService.DEFAULT_SELLER_SHIP_DEADLINE_DAYS,
      );

      // -----------------------------------------------------
      // سناریو ۱: معاوضه (پشتیبانی از پرداخت دوطرفه)
      // -----------------------------------------------------
      if (orderType === 'EXCHANGE') {
        const offer = await tx.exchangeOffer.findUnique({
          where: { id: finalExchangeId },
          include: { listing: { include: { direct: true } } }
        });

        if (!offer) throw new NotFoundException('درخواست معاوضه یافت نشد');
        if (offer.status !== 'ACCEPTED') throw new BadRequestException('این معاوضه هنوز تایید نشده است');

        listingId = offer.listingId;
        categoryId = offer.listing.categoryId;

        // تشخیص اینکه چه کسی الان در حال پرداخت است
        const isBuyer = userId === offer.offererId;
        const isSeller = userId === offer.listing.authorId;

        if (!isBuyer && !isSeller) {
          throw new ForbiddenException('شما طرفین این معامله نیستید');
        }

        // 💰 محاسبه سهم پرداختی شخص فعلی
        if (isBuyer) {
          finalPrice = offer.isPayerMe ? Number(offer.extraPayment) : 0;
        } else {
          finalPrice = !offer.isPayerMe ? Number(offer.extraPayment) : 0;
        }

        // هزینه پستی ثابت برای هاب (یا صفر، بسته به سیاست شما)
        shippingCost = 0; // معمولاً در معاوضه هر کسی هزینه ارسال خودش به هاب رو درب پست میده
        verificationFee = hubFee;
        platformAddress = hubAddress;

        const totalPayable = finalPrice + shippingCost + verificationFee;

        // 💳 کسر از کیف پول شخص فعلی و انتقال به حساب امانی
        if (paymentMethod === 'WALLET' && totalPayable > 0) {
          const wallet = await tx.wallet.findUnique({ where: { userId } });
          if (!wallet || Number(wallet.balanceAvailable) < totalPayable) {
            throw new BadRequestException('موجودی کیف پول شما کافی نیست');
          }

          const otherUserId = isBuyer ? offer.listing.authorId : offer.offererId;
          const platformCommission = await this.feeCalculator.calculateFee(ListingType.EXCHANGE, categoryId, finalPrice);
          const totalPlatformCut = Number(platformCommission) + shippingCost + verificationFee;

          await this.walletService.transferToEscrow(
            userId,
            otherUserId,
            totalPayable,
            totalPlatformCut, // 👈 این متغیر درست محاسبه و پاس داده شد
            listingId,
            tx
          );
        }

        // پردازش آدرس شخصی که الان داره چک‌اوت میکنه
        let currentAddressStr = null;
        let currentPhone = null;
        let currentPostal = null;
        if (addressId) {
          const fetchedAddress = await tx.address.findUnique({ where: { id: addressId } });
          if (fetchedAddress) {
            currentAddressStr = `${fetchedAddress.province}، ${fetchedAddress.city}، ${fetchedAddress.fullAddress}`;
            currentPhone = fetchedAddress.phone;
            currentPostal = fetchedAddress.postalCode;
          }
        }

        // 🔍 بررسی اینکه آیا طرف مقابل قبلاً سفارش را ایجاد کرده است یا نه؟
        const existingExchangeOrder = await tx.order.findFirst({
          where: { exchangeOfferId: finalExchangeId }
        });

        if (existingExchangeOrder) {
          const updateData: any = {};

          if (isBuyer) {
            if (existingExchangeOrder.shippingAddress) throw new BadRequestException('شما قبلاً پرداخت خود را انجام داده‌اید');
            updateData.shippingAddress = currentAddressStr;
            updateData.shippingPhone = currentPhone;
            updateData.shippingPostalCode = currentPostal;
          } else {
            if (existingExchangeOrder.sellerShippingAddress) throw new BadRequestException('شما قبلاً پرداخت خود را انجام داده‌اید');
            updateData.sellerShippingAddress = currentAddressStr;
            updateData.sellerShippingPhone = currentPhone;
            updateData.sellerShippingPostalCode = currentPostal;
          }

          updateData.totalAmount = Number(existingExchangeOrder.totalAmount) + totalPayable;
          updateData.paymentMethod = paymentMethod;
          return await tx.order.update({ where: { id: existingExchangeOrder.id }, data: updateData });

        }


        else {
          // ✨ نفر اولی است که چک‌اوت می‌کند، پس سفارش را می‌سازیم

          // 🎯 حل مشکل کارمزد: همیشه کل مبلغ سرک (مابه‌التفاوت) را ملاک محاسبه قرار می‌دهیم
          const totalExchangeExtraPayment = Number(offer.extraPayment || 0);

          // محاسبه کارمزد روی کل مبلغ سرک
          const platformCommission = await this.feeCalculator.calculateFee(ListingType.EXCHANGE, categoryId, totalExchangeExtraPayment);

          // دریافتی نهایی (در صورت وجود مابه‌التفاوت) منهای کارمزد شما
          const sellerRev = new Decimal(totalExchangeExtraPayment).minus(platformCommission).toString();

          const orderPayload: any = {
            buyer: { connect: { id: offer.offererId } },
            seller: { connect: { id: offer.listing.authorId } },
            listing: { connect: { id: listingId } },
            type: OrderType.EXCHANGE,
            exchangeOfferId: finalExchangeId,
            status: 'AWAITING_SHIPMENT_TO_HUB',

            // 👈 اینجا کل مبلغ مابه‌التفاوت رو به عنوان قیمت پایه معامله ثبت می‌کنیم
            finalPrice: totalExchangeExtraPayment,

            shippingCost: shippingCost,
            totalAmount: totalPayable, // پولی که شخص اول در همین لحظه پرداخت کرده
            requiresVerification: true,
            verificationFee: verificationFee,
            platformAddress: hubAddress,

            platformFee: platformCommission, // 👈 کارمزد درست و حسابی شما!
            sellerRevenue: sellerRev,
            paymentMethod: paymentMethod,
          };

          if (isBuyer) {
            orderPayload.shippingAddress = currentAddressStr;
            orderPayload.shippingPhone = currentPhone;
            orderPayload.shippingPostalCode = currentPostal;
          } else {
            orderPayload.sellerShippingAddress = currentAddressStr;
            orderPayload.sellerShippingPhone = currentPhone;
            orderPayload.sellerShippingPostalCode = currentPostal;
          }

          const createdOrder = await tx.order.create({ data: orderPayload });
          await tx.listing.update({ where: { id: listingId }, data: { status: ListingStatus.SOLD } });
          return createdOrder;
        }

      }
        // -----------------------------------------------------
        // سناریو ۲: مزایده
      // -----------------------------------------------------
      else if (orderType === 'AUCTION') {
        const listing = await tx.listing.findUnique({
          where: { id: listingId },
          include: {
            auction: {
              include: {
                bids: {
                  where: { bidderId: userId, status: AuctionBidStatus.ACTIVE },
                  orderBy: { amount: 'desc' },
                  take: 1,
                },
              },
            },
          },
        });
        if (!listing || !listing.auction || !listing.auction.bids[0]) throw new BadRequestException('اطلاعات مزایده یافت نشد');
        if (listing.auction.status !== AuctionStatus.FINISHED) {
          throw new BadRequestException('این مزایده هنوز نهایی نشده است');
        }
        if (listing.auction.settlementStatus !== AuctionSettlementStatus.PENDING) {
          throw new BadRequestException('وضعیت تسویه این مزایده قابل پرداخت نیست');
        }
        if (listing.auction.highestBidderId !== userId) {
          throw new ForbiddenException('فقط برنده فعلی مزایده می‌تواند پرداخت و سفارش را نهایی کند');
        }

        const winnerBidAmount = Number(listing.auction.bids[0].amount);
        const guaranteeBlocked = Number(listing.auction.bids[0].blockedAmount || 0);
        auctionWinnerBidId = listing.auction.bids[0].id;
        finalPrice = winnerBidAmount;
        auctionBlockedDeposit = Math.max(0, guaranteeBlocked);

        sellerId = listing.authorId;
        categoryId = listing.categoryId;
        if (sellerId === userId) throw new ForbiddenException('شما نمی‌توانید آگهی خودتان را بخرید.');

        shippingCost = listing.shippingPayer === 'BUYER_PREPAID' ? shippingFee : 0;
        sellerRequestedVerification = listing.sellerRequiresVerification || false;
      }
        // -----------------------------------------------------
        // سناریو ۳: خرید مستقیم
      // -----------------------------------------------------
      else {
        const listing = await tx.listing.findUnique({
          where: { id: listingId },
          include: { direct: true }
        });
        if (!listing || listing.status !== 'APPROVED') throw new BadRequestException('آگهی یافت نشد یا فروخته شده');

        finalPrice = Number(listing.direct?.price || 0);
        sellerId = listing.authorId;
        categoryId = listing.categoryId;
        if (sellerId === userId) throw new ForbiddenException('شما نمی‌توانید آگهی خودتان را بخرید.');

        shippingCost = listing.shippingPayer === 'BUYER_PREPAID' ? shippingFee : 0;
        sellerRequestedVerification = listing.sellerRequiresVerification || false;
      }

      // --- بررسی و حذف سفارش‌های معلق قبلی ---
      const existingOrder = await tx.order.findFirst({
        where: { listingId: listingId }
      });

      if (existingOrder) {
        if (existingOrder.status === OrderStatus.PENDING || existingOrder.status === OrderStatus.CANCELLED) {
          await tx.order.delete({ where: { id: existingOrder.id } });
        } else {
          throw new BadRequestException('این کالا در حال حاضر به فروش رسیده و در جریان است.');
        }
      }

      // 👇 منطق هوشمند کارشناسی
      const isHubRequired = requiresVerification || sellerRequestedVerification;
      let feeChargedToBuyer = 0;
      let feeChargedToSeller = 0;

      if (isHubRequired && orderType !== 'EXCHANGE') {
        verificationFee = hubFee;
        platformAddress = hubAddress;

        if (sellerRequestedVerification) {
          feeChargedToSeller = hubFee;
        } else if (requiresVerification) {
          feeChargedToBuyer = hubFee;
        }
      }

      // مبلغ کل پرداختی خریدار
      const totalPayable = (
        orderType === 'AUCTION'
          ? Math.max(0, finalPrice - auctionBlockedDeposit) + shippingCost + feeChargedToBuyer
          : finalPrice + shippingCost + feeChargedToBuyer
      );

      const platformFee = await this.feeCalculator.calculateFee(
        orderType === 'AUCTION' ? ListingType.AUCTION : (orderType === 'EXCHANGE' ? ListingType.EXCHANGE : ListingType.DIRECT),
        categoryId,
        finalPrice
      );

      // 🎯 لاجیک طلایی واریزی فروشنده
      const sellerRevenue = new Decimal(finalPrice)
        .minus(platformFee)
        .plus(shippingCost)
        .minus(feeChargedToSeller)
        .toString();

      // 👇 متغیر جدید برای سیستم امانی (مجموع کارمزد پلتفرم + هزینه کارشناسی)
      const totalPlatformCut = Number(platformFee) + feeChargedToSeller + feeChargedToBuyer;

      if (paymentMethod === 'WALLET' && totalPayable > 0) {
        const wallet = await tx.wallet.findUnique({ where: { userId } });
        if (!wallet || Number(wallet.balanceAvailable) < totalPayable) {
          throw new BadRequestException('موجودی کیف پول کافی نیست');
        }

        if (orderType === 'AUCTION') {
          await this.walletService.payAuctionFinal(
            buyerId,
            sellerId,
            finalPrice,
            auctionBlockedDeposit,
            platformFee,
            listingId,
            tx,
          );

          if (shippingCost > 0) {
            await this.walletService.payFromAvailable(
              buyerId,
              shippingCost,
              `${listingId}:shipping`,
              tx,
            );

            const sellerWallet = await tx.wallet.upsert({
              where: { userId: sellerId },
              create: {
                userId: sellerId,
                balanceAvailable: 0,
                balanceBlocked: shippingCost,
              },
              update: {
                balanceBlocked: { increment: shippingCost },
              },
            });

            await tx.walletTransaction.create({
              data: {
                walletId: sellerWallet.id,
                amount: shippingCost,
                type: WalletTransactionType.DEPOSIT,
                status: WalletTransactionStatus.PENDING,
                referenceId: listingId,
                meta: { description: 'هزینه ارسال مزایده (بلوکه)' },
              },
            });
          }

          if (feeChargedToBuyer > 0) {
            await this.walletService.payFromAvailable(
              buyerId,
              feeChargedToBuyer,
              `${listingId}:verification`,
              tx,
            );
          }

          const otherActiveBids = await tx.auctionBid.findMany({
            where: {
              listingId,
              status: AuctionBidStatus.ACTIVE,
              bidderId: { not: buyerId },
            },
          });
          for (const bid of otherActiveBids) {
            const blocked = Number(bid.blockedAmount || 0);
            if (blocked > 0) {
              await this.walletService.unblockAmount(bid.bidderId, blocked, listingId, tx);
            }
            await tx.auctionBid.update({
              where: { id: bid.id },
              data: { status: AuctionBidStatus.LOST, blockedAmount: 0 },
            });
          }

          if (auctionWinnerBidId) {
            await tx.auctionBid.update({
              where: { id: auctionWinnerBidId },
              data: { status: AuctionBidStatus.WON, blockedAmount: 0 },
            });
          }
        } else {
          // 🎯 سیستم امانی با محاسبه دقیق فراخوانی شد
          await this.walletService.transferToEscrow(
            buyerId,
            sellerId,
            totalPayable,
            totalPlatformCut,
            listingId,
            tx,
          );
        }
      }

      let orderStatus: OrderStatus = OrderStatus.PENDING;

      if (paymentMethod === 'WALLET' || totalPayable === 0) {
        if (orderType === 'EXCHANGE' || isHubRequired) {
          orderStatus = 'AWAITING_SHIPMENT_TO_HUB' as OrderStatus;
        } else {
          orderStatus = OrderStatus.PAID;
        }
      } else if (paymentMethod === 'GATEWAY' && totalPayable > 0) {
        orderStatus = OrderStatus.AWAITING_PAYMENT;
      }

      const orderPayload: any = {
        buyer: { connect: { id: buyerId } },
        seller: { connect: { id: sellerId } },
        listing: { connect: { id: listingId } },
        type: orderType as any,
        finalPrice: finalPrice,
        shippingCost: shippingCost,
        totalAmount: totalPayable,
        sellerRevenue: sellerRevenue,
        platformFee: platformFee,
        status: orderStatus,
        paymentMethod: paymentMethod,
        requiresVerification: Boolean(isHubRequired || orderType === 'EXCHANGE'),
        verificationFee: verificationFee,
        platformAddress: platformAddress,
      };

      if (finalExchangeId) orderPayload.exchangeOfferId = finalExchangeId;

      if (
        orderStatus !== OrderStatus.PENDING &&
        orderStatus !== OrderStatus.AWAITING_PAYMENT
      ) {
        const deadline = new Date();
        deadline.setDate(deadline.getDate() + sellerShipDeadlineDays);
        orderPayload.shippingDeadline = deadline;
      }

      if (addressId) {
        const fetchedAddress = await tx.address.findUnique({ where: { id: addressId } });
        if (fetchedAddress) {
          orderPayload.shippingAddress = `${fetchedAddress.province}، ${fetchedAddress.city}، ${fetchedAddress.fullAddress}`;
          orderPayload.shippingPhone = fetchedAddress.phone;
          orderPayload.shippingPostalCode = fetchedAddress.postalCode;
        }
      }

      const createdOrder = await tx.order.create({ data: orderPayload });

      if (
        orderStatus !== OrderStatus.PENDING &&
        orderStatus !== OrderStatus.AWAITING_PAYMENT
      ) {
        if (orderType === 'AUCTION') {
          await tx.listingAuction.update({
            where: { listingId },
            data: { settlementStatus: AuctionSettlementStatus.PAID },
          });
        }
        await tx.listing.update({ where: { id: listingId }, data: { status: ListingStatus.SOLD } });
      }

      return createdOrder;
    });

    if (paymentMethod === 'GATEWAY' && Number(order.totalAmount) > 0) {
      const initiated = await this.paymentsService.initiateOrderPayment(order.id, userId);
      paymentUrl = initiated.paymentUrl;
    }

    return {
      ...order,
      paymentUrl: paymentUrl
    };
  }  // 4. ثبت کد رهگیری
  // =================================================================
  async updateTrackingCode(userId: string, orderId: string, trackingCode: string, videoPath?: string) {
    if (!/^\d{24}$/.test(trackingCode)) {
      throw new BadRequestException('کد رهگیری باید دقیقاً ۲۴ رقم باشد.');
    }

    // ویدیوی بسته‌بندی برای هرگونه ارسال (فروش/معاوضه) الزامی است
    if (!videoPath) {
      throw new BadRequestException(
        'ویدیوی بسته‌بندی کالا الزامی است. لطفاً هنگام بسته‌بندی از کالا فیلم بگیرید.',
      );
    }

    const order = await this.prisma.order.findUnique({
      where: { id: orderId },
      include: { listing: true },
    });

    if (!order) throw new NotFoundException('سفارش یافت نشد');

    const isSeller = order.sellerId === userId;
    const isBuyer = order.buyerId === userId;

    if (!isSeller && !isBuyer) throw new ForbiddenException('دسترسی غیرمجاز');

    const updateData: Prisma.OrderUpdateInput = {};

    // منطق هوشمند: آیا کالا باید به هاب برود یا مستقیم به خریدار؟
    const needsHub = order.type === OrderType.EXCHANGE ||
      order.requiresVerification ||
      order.listing?.sellerRequiresVerification;

    updateData.status = needsHub ? OrderStatus.SHIPPED_TO_HUB : OrderStatus.SHIPPED;

    // جایگذاری صحیح کد رهگیری و ویدیو بر اساس شخص ارسال‌کننده
    if (isSeller) {
      if (order.trackingCode) {
        throw new BadRequestException('شما قبلاً کد رهگیری این ارسال را ثبت کرده‌اید');
      }
      updateData.trackingCode = trackingCode;
      updateData.packagingVideo = videoPath;
    } else if (order.type === OrderType.EXCHANGE && isBuyer) {
      if (order.sellerTrackingCode) {
        throw new BadRequestException('شما قبلاً کد رهگیری این ارسال را ثبت کرده‌اید');
      }
      updateData.sellerTrackingCode = trackingCode;
      updateData.buyerPackagingVideo = videoPath;
    } else {
      throw new ForbiddenException('شما مجاز به ثبت اطلاعات ارسال برای این سفارش نیستید');
    }

    return this.prisma.order.update({
      where: { id: orderId },
      data: updateData,
    });
  }
  // =================================================================
  // 5. تایید نهایی سفارش
  // =================================================================
  async confirmOrder(userId: string, orderId: string) {
    return this.prisma.$transaction(async (tx) => {
      const order = await tx.order.findUnique({ where: { id: orderId } });

      if (!order) throw new NotFoundException('سفارش یافت نشد');
      if (order.type === OrderType.EXCHANGE) {
        const isBuyer = order.buyerId === userId;
        const isSeller = order.sellerId === userId;
        if (!isBuyer && !isSeller) {
          throw new BadRequestException('شما طرفین این سفارش نیستید');
        }
        if (order.status === OrderStatus.COMPLETED) {
          throw new BadRequestException('این سفارش قبلاً تسویه شده است');
        }
        this.stateMachine.assertTransition(order.status, OrderStatus.COMPLETED, 'confirm-order-exchange');

        const updateData: Prisma.OrderUpdateInput = {};
        if (isBuyer && !order.buyerConfirmedDelivery) {
          updateData.buyerConfirmedDelivery = true;
        }
        if (isSeller && !order.sellerConfirmedDelivery) {
          updateData.sellerConfirmedDelivery = true;
        }
        const afterAck = await tx.order.update({
          where: { id: orderId },
          data: updateData,
        });

        const bothConfirmed =
          (afterAck.buyerConfirmedDelivery || isBuyer) &&
          (afterAck.sellerConfirmedDelivery || isSeller);
        if (!bothConfirmed) {
          return afterAck;
        }

        const amountToRelease = Number(order.sellerRevenue);
        if (amountToRelease > 0) {
          await this.walletService.releaseEscrow(
            order.sellerId,
            amountToRelease,
            order.listingId,
            tx,
          );
        }

        return tx.order.update({
          where: { id: orderId },
          data: { status: OrderStatus.COMPLETED },
        });
      }

      if (order.buyerId !== userId) throw new BadRequestException('شما خریدار این سفارش نیستید');

      // اجازه نمیدیم سفارشی که قبلا تکمیل شده دوباره تایید بشه
    if (order.status === OrderStatus.COMPLETED) throw new BadRequestException('این سفارش قبلاً تسویه شده است');
      this.stateMachine.assertTransition(order.status, OrderStatus.COMPLETED, 'confirm-order');

      // 🎯 حل مشکل کیف پول: واریز درآمد خالص (بدون کارمزد پلتفرم) به فروشنده
      const amountToRelease = Number(order.sellerRevenue);

      // فقط در صورتی که پولی برای آزاد کردن وجود داشته باشه (مثلاً تو معاوضه‌های بدون سرک صفر هست)
      if (amountToRelease > 0) {
        await this.walletService.releaseEscrow(
          order.sellerId,
          amountToRelease, // 👈 اینجا مبلغ خالص پاس داده شد
          order.listingId,
          tx,
        );
      }

      await tx.user.update({
        where: { id: order.sellerId },
        data: { trustScore: { increment: 2 } }
      });

      // 🎯 تغییر وضعیت به تکمیل شده (تسویه نهایی)
      return tx.order.update({
        where: { id: orderId },
        data: { status: OrderStatus.COMPLETED },
      });
    });
  }
  // =================================================================
  // 6. دریافت جزئیات سفارش
  // =================================================================
  async getOrderById(userId: string, orderId: string) {
    const order = await this.prisma.order.findUnique({
      where: { id: orderId },
      include: {
        listing: {
          select: {
            id: true,
            title: true,
            thumbnail: true,
            type: true,
            status: true,
            condition: true,
            shippingPayer: true,
            sellerRequiresVerification: true,
          },
        },
        // phone رو بعداً بر اساس شرایط اضافه/حذف میکنیم.
        buyer: { select: { id: true, firstName: true, lastName: true, avatar: true, phone: true } },
        seller: { select: { id: true, firstName: true, lastName: true, avatar: true, phone: true } },
      },
    });

    if (!order) throw new NotFoundException('سفارش یافت نشد');
    if (order.buyerId !== userId && order.sellerId !== userId) {
      throw new ForbiddenException('عدم دسترسی');
    }

    if (order.type === 'EXCHANGE' && order.exchangeOfferId) {
      const exchangeOffer = await this.prisma.exchangeOffer.findUnique({
        where: { id: order.exchangeOfferId },
        select: {
          id: true,
          title: true,
          description: true,
          images: true,
          extraPayment: true,
          isPayerMe: true,
          status: true,
          createdAt: true,
        },
      });
      (order as any).exchangeOffer = exchangeOffer;
    }

    if (order.status === OrderStatus.REJECTED_AT_HUB) {
      const relatedTicket = await this.prisma.ticket.findFirst({
        where: {
          userId,
          OR: [
            { subject: { contains: `[ORDER:${orderId}]` } },
            { subject: { contains: orderId.slice(-6) } },
          ],
        },
        orderBy: { createdAt: 'desc' },
        select: { id: true },
      });
      (order as any).supportTicketId = relatedTicket?.id ?? null;
    }

    const needsHub = order.requiresVerification || order.type === 'EXCHANGE';
    const isSellerView = order.sellerId === userId;
    const isBuyerView = order.buyerId === userId;

    // شماره تلفن طرف مقابل فقط بعد از SHIPPED/DELIVERED (یعنی نیاز واقعی
    // ارتباط هست) قابل مشاهده‌ست. قبل از اون، شماره حذف میشه.
    const contactReleased =
      order.status === 'SHIPPED' || order.status === 'DELIVERED' ||
      order.status === 'COMPLETED' || order.status === 'DISPUTED';

    const stripPhone = (u: { phone?: string | null } | null) =>
      u ? { ...u, phone: contactReleased ? u.phone : null } : u;

    if (order.buyer) order.buyer = stripPhone(order.buyer) as typeof order.buyer;
    if (order.seller) order.seller = stripPhone(order.seller) as typeof order.seller;

    // حالت هاب (کالا قبل از ارسال به خریدار باید به طبقه ارسال بشه).
    // در این حالت آدرس واقعی خریدار به فروشنده نمایش داده نمیشه و کلاً
    // اطلاعات طرف مقابل ماسک می‌مونه.
    if (needsHub && isSellerView) {
      const hubAddress = order.platformAddress || 'تهران، دفتر مرکزی پردازش و کارشناسی طبقه';
      const maskedOrder: any = {
        ...order,
        buyer: order.buyer
          ? { id: order.buyer.id, firstName: 'خریدار', lastName: '', avatar: null, phone: null }
          : null,
      };
      maskedOrder.shippingAddress = {
        fullAddress: hubAddress,
        city: 'تهران',
        province: 'تهران',
        postalCode: '1111111111',
        phone: '021-00000000',
      };
      maskedOrder.isMaskedForVerification = true;
      return maskedOrder;
    }

    // اقتصاد داخلی پلتفرم نباید به خریدار لو بره.
    if (isBuyerView) {
      const cloned: any = { ...order };
      cloned.platformFee = undefined;
      cloned.sellerRevenue = undefined;
      cloned.sellerShippingCost = undefined;
      return cloned;
    }

    return order;
  }  // =================================================================
  // 7. ثبت شکایت (Dispute) ✅ اصلاح شده برای حل ارور includes
  // =================================================================
  async disputeOrder(buyerId: string, orderId: string, reason: string, videoPath?: string) {
    return this.prisma.$transaction(async (tx) => {
      const order = await tx.order.findUnique({ where: { id: orderId }, include: { listing: true } });

      if (!order) throw new NotFoundException('سفارش یافت نشد');
      if (order.buyerId !== buyerId) throw new BadRequestException('شما خریدار نیستید');
      if (order.type === OrderType.EXCHANGE) {
        throw new BadRequestException('برای معاملات معاوضه امکان ثبت شکایت در این مرحله وجود ندارد');
      }

      // ✅ اصلاح شده: استفاده از شرط صریح به جای includes
      if (order.status !== OrderStatus.SHIPPED && order.status !== OrderStatus.DELIVERED) {
        throw new BadRequestException('وضعیت سفارش برای شکایت مناسب نیست');
      }

      this.stateMachine.assertTransition(order.status, OrderStatus.DISPUTED, 'dispute-order');
      await tx.order.update({
        where: { id: orderId },
        data: {
          status: OrderStatus.DISPUTED,
          unboxingVideo: videoPath,
          disputeReason: reason,
          disputedAt: new Date(),
        },
      });

      const apiUrl = this.appSettings.getApiUrl();
      const videoLink = videoPath ? `\n🎥 ویدیو: ${apiUrl}/uploads/orders/${videoPath}` : '';

      const ticketMessage = `🚨 **اعلام مغایرت سفارش**\nکالا: ${order.listing.title}\nعلت: ${reason}\n${videoLink}`;

      await tx.ticket.create({
        data: {
          userId: buyerId,
          subject: `شکایت سفارش #${order.id.slice(-6)}`,
          status: 'OPEN',
          messages: {
            create: { senderRole: 'USER', message: ticketMessage }
          }
        }
      });

      return { success: true, message: 'شکایت شما ثبت شد و مبلغ مسدود ماند.' };
    });
  }

  // =================================================================
  // 8. جاب‌های خودکار
  // =================================================================

  @Cron(CronExpression.EVERY_HOUR)
  async autoCancelExpiredOrders() {
    const now = new Date();
    const exchangeCompensation = await this.getExchangeNoShipmentCompensation();
    const expiredOrders = await this.prisma.order.findMany({
      where: {
        status: { in: [OrderStatus.PAID, OrderStatus.AWAITING_SHIPMENT_TO_HUB] },
        shippingDeadline: { lt: now },
      },
    });

    for (const order of expiredOrders) {
      try {
        await this.prisma.$transaction(async (tx) => {
          const sellerSent = Boolean(order.trackingCode);
          const buyerSentForExchange = order.type === OrderType.EXCHANGE && Boolean(order.sellerTrackingCode);

          if (Number(order.sellerRevenue) > 0) {
            await tx.wallet.upsert({
              where: { userId: order.sellerId },
              create: {
                userId: order.sellerId,
                balanceAvailable: 0,
                balanceBlocked: 0,
              },
              update: { balanceBlocked: { decrement: order.sellerRevenue } },
            });
          }

          if (Number(order.totalAmount) > 0) {
            await tx.wallet.upsert({
              where: { userId: order.buyerId },
              create: {
                userId: order.buyerId,
                balanceAvailable: order.totalAmount,
                balanceBlocked: 0,
              },
              update: { balanceAvailable: { increment: order.totalAmount } },
            });
          }

          if (order.type === OrderType.EXCHANGE && exchangeCompensation > 0) {
            if (sellerSent && !buyerSentForExchange) {
              await this.creditExchangeCompensation(
                tx,
                order.sellerId,
                exchangeCompensation,
                order.id,
              );
            } else if (buyerSentForExchange && !sellerSent) {
              await this.creditExchangeCompensation(
                tx,
                order.buyerId,
                exchangeCompensation,
                order.id,
              );
            }
          }

          await tx.user.update({
            where: { id: order.sellerId },
            data: { trustScore: { decrement: 15 } }
          });
          this.stateMachine.assertTransition(order.status, OrderStatus.CANCELLED, 'auto-cancel-expired');
          await tx.order.update({
            where: { id: order.id },
            data: { status: OrderStatus.CANCELLED, cancelReason: 'عدم ارسال در مهلت مقرر' },
          });
          await tx.listing.update({
            where: { id: order.listingId },
            data: { status: ListingStatus.APPROVED },
          });
        });
      } catch (error) {
        console.error(`Error auto-canceling order ${order.id}:`, error);
      }
    }
  }

  @Cron(CronExpression.EVERY_HOUR)
  async autoConfirmOrders() {
    const buyerConfirmDeadlineDays = await this.getBuyerConfirmDeadlineDays();
    const threshold = new Date(
      Date.now() - buyerConfirmDeadlineDays * 24 * 60 * 60 * 1000,
    );
    const pendingOrders = await this.prisma.order.findMany({
      where: {
        status: { in: [OrderStatus.SHIPPED, OrderStatus.DELIVERED] },
        updatedAt: { lte: threshold },
      },
    });

    for (const order of pendingOrders) {
      try {
        if (order.type === OrderType.EXCHANGE) {
          await this.prisma.$transaction(async (tx) => {
            const locked = await tx.order.findUnique({ where: { id: order.id } });
            if (!locked) return;
            if (locked.status === OrderStatus.COMPLETED || locked.status === OrderStatus.CANCELLED) return;

            const amountToRelease = Number(locked.sellerRevenue);
            if (amountToRelease > 0) {
              await this.walletService.releaseEscrow(
                locked.sellerId,
                amountToRelease,
                locked.listingId,
                tx,
              );
            }
            await tx.order.update({
              where: { id: locked.id },
              data: {
                buyerConfirmedDelivery: true,
                sellerConfirmedDelivery: true,
                status: OrderStatus.COMPLETED,
              },
            });
          });
        } else {
          await this.confirmOrder(order.buyerId, order.id);
        }
        console.log(`Auto-confirmed order ${order.id}`);
      } catch (error) {
        console.error(`Error auto-confirming order ${order.id}:`, error);
      }
    }
  }

  private parsePositiveIntSetting(
    value: string | null | undefined,
    fallback: number,
  ): number {
    const parsed = Number(value ?? '');
    if (!Number.isFinite(parsed) || parsed <= 0) return fallback;
    return Math.floor(parsed);
  }

  private async getBuyerConfirmDeadlineDays(): Promise<number> {
    const setting = await this.prisma.systemSetting.findUnique({
      where: { key: 'BUYER_CONFIRM_DEADLINE_DAYS' },
      select: { value: true },
    });
    return this.parsePositiveIntSetting(
      setting?.value,
      OrdersService.DEFAULT_BUYER_CONFIRM_DEADLINE_DAYS,
    );
  }

  private async getExchangeNoShipmentCompensation(): Promise<number> {
    const setting = await this.prisma.systemSetting.findUnique({
      where: { key: 'EXCHANGE_NO_SHIPMENT_COMPENSATION' },
      select: { value: true },
    });
    const parsed = this.parsePositiveIntSetting(
      setting?.value,
      OrdersService.DEFAULT_EXCHANGE_NO_SHIPMENT_COMPENSATION,
    );
    return Math.max(0, parsed);
  }

  private async creditExchangeCompensation(
    tx: Prisma.TransactionClient,
    userId: string,
    amount: number,
    orderId: string,
  ): Promise<void> {
    await tx.wallet.upsert({
      where: { userId },
      create: {
        userId,
        balanceAvailable: amount,
        balanceBlocked: 0,
      },
      update: {
        balanceAvailable: { increment: amount },
      },
    });
    await tx.walletTransaction.create({
      data: {
        wallet: { connect: { userId } },
        amount,
        type: WalletTransactionType.DEPOSIT,
        status: WalletTransactionStatus.SUCCESS,
        referenceId: orderId,
        meta: {
          kind: 'exchange-compensation',
          description: 'به پاس عذرخواهی بابت عدم ارسال طرف مقابل',
        },
      },
    });
  }
}