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
  NotificationType,
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
import { NotificationService } from '../notification/notification.service';

@Injectable()
export class OrdersService {
  private static readonly DEFAULT_SELLER_SHIP_DEADLINE_MINUTES = 3 * 24 * 60;
  private static readonly DEFAULT_BUYER_CONFIRM_DEADLINE_MINUTES = 4 * 24 * 60;
  private static readonly DEFAULT_EXCHANGE_NO_SHIPMENT_COMPENSATION = 0;
  private static readonly EXCHANGE_NO_PAYMENT_TIMEOUT_HOURS = 24;
  private static readonly EXCHANGE_SECOND_PAYMENT_TIMEOUT_HOURS = 48;
  private static readonly EXCHANGE_SHIPMENT_TIMEOUT_HOURS = 48;

  constructor(
    private readonly prisma: PrismaService,
    private readonly walletService: WalletService,
    private readonly feeCalculator: FeeCalculatorService,
    private readonly appSettings: AppSettingsService,
    private readonly stateMachine: OrdersStateMachineService,
    private readonly paymentsService: PaymentsService,
    private readonly notificationService: NotificationService,
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
          listingId: true,
          buyerId: true,
          sellerId: true,
          exchangeOfferId: true,
          shippingAddress: true,
          sellerShippingAddress: true,
          status: true,
          type: true,
          totalAmount: true,
          createdAt: true,
          updatedAt: true,
          paymentMethod: true,
          requiresVerification: true,
          trackingCode: true,
          sellerTrackingCode: true,
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
            select: { id: true, title: true, thumbnail: true, gallery: true, status: true },
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
          },
        })
      : [];
    const orderByOfferId = new Map(linkedOrders.map((o) => [o.exchangeOfferId, o]));
    const exchangeOffersWithPaymentState = exchangeOffers.map((offer) => {
      const linked = orderByOfferId.get(offer.id);
      const mySharePaid = Boolean(linked?.shippingAddress);
      return {
        ...offer,
        exchangeOrderId: linked?.id ?? null,
        mySharePaid,
      };
    });

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

    return { exchangeOffers: exchangeOffersWithPaymentState, auctionBids };
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
      const sellerShipDeadlineSetting = await tx.systemSetting.findFirst({
        where: { key: { in: ['SELLER_SHIP_DEADLINE_MINUTES', 'SELLER_SHIP_DEADLINE_DAYS'] } },
      });
      const addressSetting = await tx.systemSetting.findUnique({ where: { key: 'PLATFORM_ADDRESS' } });
      const hubAddress = addressSetting ? addressSetting.value : 'تهران، دفتر مرکزی پردازش و کارشناسی طبقه';
      const hubFee = feeSetting ? Number(feeSetting.value) : 250000;
      const shippingFee = shippingSetting ? Number(shippingSetting.value) : 50000;
      const sellerShipDeadlineMinutes = this.parsePositiveIntSetting(
        sellerShipDeadlineSetting?.value,
        OrdersService.DEFAULT_SELLER_SHIP_DEADLINE_MINUTES,
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
          const verificationFeePerSide = Number(existingExchangeOrder.verificationFee || 0);
          const extraPayment = Number(offer.extraPayment || 0);
          const buyerDue = verificationFeePerSide + (offer.isPayerMe ? extraPayment : 0);
          const sellerDue = verificationFeePerSide + (!offer.isPayerMe ? extraPayment : 0);
          const expectedTotal = buyerDue + sellerDue;
          const currentTotal = Number(existingExchangeOrder.totalAmount || 0);
          const isExchangeIncomplete = currentTotal < expectedTotal;

          if (isBuyer) {
            // اگر تسویه کامل نشده باشد، وجود آدرس به معنی پرداخت قطعی نیست
            // (ممکن است attempt قبلی ناموفق/ناتمام بوده باشد).
            if (existingExchangeOrder.shippingAddress && !isExchangeIncomplete) {
              throw new BadRequestException('شما قبلاً پرداخت خود را انجام داده‌اید');
            }
            updateData.shippingAddress = currentAddressStr;
            updateData.shippingPhone = currentPhone;
            updateData.shippingPostalCode = currentPostal;
          } else {
            if (existingExchangeOrder.sellerShippingAddress && !isExchangeIncomplete) {
              throw new BadRequestException('شما قبلاً پرداخت خود را انجام داده‌اید');
            }
            updateData.sellerShippingAddress = currentAddressStr;
            updateData.sellerShippingPhone = currentPhone;
            updateData.sellerShippingPostalCode = currentPostal;
          }

          // در کیف پول، مبلغ همین لحظه واقعاً پرداخت می‌شود؛ در درگاه بعد از callback.
          if (paymentMethod === 'WALLET') {
            updateData.totalAmount = Number(existingExchangeOrder.totalAmount) + totalPayable;
          }
          if (isExchangeIncomplete) {
            updateData.status = OrderStatus.AWAITING_PAYMENT;
          }
          updateData.paymentMethod = paymentMethod;
          const updatedOrder = await tx.order.update({ where: { id: existingExchangeOrder.id }, data: updateData });

          const bothSidesProvidedAddress =
            !!updatedOrder.shippingAddress && !!updatedOrder.sellerShippingAddress;
          if (bothSidesProvidedAddress && paymentMethod === 'WALLET') {
            const deadline = new Date(Date.now() + sellerShipDeadlineMinutes * 60 * 1000);
            await tx.order.update({
              where: { id: updatedOrder.id },
              data: {
                status: OrderStatus.AWAITING_SHIPMENT_TO_HUB,
                shippingDeadline: deadline,
              },
            });
            await tx.listing.update({
              where: { id: listingId },
              data: { status: ListingStatus.SOLD },
            });
          }

          return updatedOrder;

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
            // تا وقتی هر دو طرف سهم خودشان را پرداخت نکنند، ارسال باز نمی‌شود.
            status: OrderStatus.AWAITING_PAYMENT,

            // 👈 اینجا کل مبلغ مابه‌التفاوت رو به عنوان قیمت پایه معامله ثبت می‌کنیم
            finalPrice: totalExchangeExtraPayment,

            shippingCost: shippingCost,
            totalAmount: paymentMethod === 'WALLET' ? totalPayable : 0, // درگاه بعد از callback اضافه می‌شود
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
        const deadline = new Date(Date.now() + sellerShipDeadlineMinutes * 60 * 1000);
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

    const shouldNotifyPurchase =
      order.type !== OrderType.EXCHANGE &&
      order.status !== OrderStatus.PENDING &&
      order.status !== OrderStatus.AWAITING_PAYMENT;
    if (shouldNotifyPurchase) {
      await this.notifyOrderPurchasedAndSold(order);
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

    if (
      order.type === OrderType.EXCHANGE &&
      (!order.shippingAddress || !order.sellerShippingAddress ||
        !([OrderStatus.AWAITING_SHIPMENT_TO_HUB, OrderStatus.SHIPPED_TO_HUB] as OrderStatus[]).includes(order.status))
    ) {
      throw new BadRequestException('ارسال کالا پس از تکمیل پرداخت هر دو طرف فعال می‌شود');
    }

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

    // در معاوضه: بعد از ثبت اولین ارسال، طرف مقابل ۴۸ ساعت فرصت دارد ارسال خودش را ثبت کند.
    if (order.type === OrderType.EXCHANGE) {
      const sellerTrackingAfter = isSeller ? trackingCode : order.trackingCode;
      const buyerTrackingAfter = isBuyer ? trackingCode : order.sellerTrackingCode;
      const onlyOneSideShipped = Boolean(sellerTrackingAfter) !== Boolean(buyerTrackingAfter);
      if (onlyOneSideShipped) {
        updateData.shippingDeadline = new Date(
          Date.now() + OrdersService.EXCHANGE_SHIPMENT_TIMEOUT_HOURS * 60 * 60 * 1000,
        );
      }
    }

    return this.prisma.order.update({
      where: { id: orderId },
      data: updateData,
    });
  }

  async submitReturnTrackingCode(
    userId: string,
    orderId: string,
    trackingCode: string,
    videoPath?: string,
  ) {
    if (!/^\d{24}$/.test(trackingCode)) {
      throw new BadRequestException('کد رهگیری باید دقیقاً ۲۴ رقم باشد.');
    }
    if (!videoPath) {
      throw new BadRequestException('ویدیوی بسته‌بندی مرجوعی الزامی است.');
    }

    const order = await this.prisma.order.findUnique({ where: { id: orderId } });
    if (!order) throw new NotFoundException('سفارش یافت نشد');
    if (order.type === OrderType.EXCHANGE) {
      throw new BadRequestException('ثبت مرجوعی برای سفارش معاوضه در این مرحله مجاز نیست');
    }
    if (order.buyerId !== userId) {
      throw new ForbiddenException('فقط خریدار می‌تواند مرجوعی را ثبت کند');
    }
    if (order.status !== OrderStatus.RETURN_REQUESTED) {
      throw new BadRequestException('این سفارش در وضعیت مناسب برای ثبت مرجوعی نیست');
    }
    if (order.returnTrackingCode) {
      throw new BadRequestException('کد رهگیری مرجوعی قبلاً ثبت شده است');
    }

    return this.prisma.order.update({
      where: { id: orderId },
      data: {
        returnTrackingCode: trackingCode,
        returnPackagingVideo: videoPath,
        returnShippedAt: new Date(),
        status: OrderStatus.RETURN_SHIPPED,
      },
    });
  }

  async confirmReturnReceipt(sellerId: string, orderId: string) {
    return this.prisma.$transaction(async (tx) => {
      const order = await tx.order.findUnique({
        where: { id: orderId },
        include: { listing: { select: { title: true, sellerRequiresVerification: true } } },
      });
      if (!order) throw new NotFoundException('سفارش یافت نشد');
      if (order.sellerId !== sellerId) {
        throw new ForbiddenException('فقط فروشنده می‌تواند دریافت مرجوعی را تایید کند');
      }
      if (order.type === OrderType.EXCHANGE) {
        throw new BadRequestException('تایید مرجوعی برای سفارش معاوضه در این مرحله مجاز نیست');
      }
      if (order.status !== OrderStatus.RETURN_SHIPPED) {
        throw new BadRequestException('این سفارش در وضعیت مناسب برای تایید مرجوعی نیست');
      }

      this.stateMachine.assertTransition(order.status, OrderStatus.CANCELLED, 'confirm-return-receipt');

      const sellerRevenue = Number(order.sellerRevenue || 0);
      const totalAmount = Number(order.totalAmount || 0);
      const shippingCost = Number(order.shippingCost || 0);
      const verificationFee = Number(order.verificationFee || 0);
      const verificationChargedToBuyer =
        order.requiresVerification && !order.listing?.sellerRequiresVerification
          ? verificationFee
          : 0;
      const refundableToBuyer = Math.max(0, totalAmount - shippingCost - verificationChargedToBuyer);

      /** یک بار مصرف: جلوگیری از دوبار کلیک / فراخوانی همزمان و بازپرداخت تکراری */
      const claimed = await tx.order.updateMany({
        where: {
          id: order.id,
          sellerId,
          status: OrderStatus.RETURN_SHIPPED,
          returnConfirmedAt: null,
        },
        data: {
          status: OrderStatus.CANCELLED,
          cancelReason: 'مرجوعی توسط فروشنده تحویل گرفته شد و بازگشت وجه انجام شد',
          returnConfirmedAt: new Date(),
          returnConfirmedBy: sellerId,
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
              debitReason: 'seller-confirmed-return',
              description: 'کسر از موجودی بلوکه فروشنده پس از تایید دریافت مرجوعی',
            },
          },
        });
      }

      if (refundableToBuyer > 0) {
        await tx.wallet.upsert({
          where: { userId: order.buyerId },
          create: {
            userId: order.buyerId,
            balanceAvailable: refundableToBuyer,
            balanceBlocked: 0,
          },
          update: { balanceAvailable: { increment: refundableToBuyer } },
        });
        await tx.walletTransaction.create({
          data: {
            wallet: { connect: { userId: order.buyerId } },
            amount: refundableToBuyer,
            type: WalletTransactionType.REFUND,
            status: WalletTransactionStatus.SUCCESS,
            referenceId: order.id,
            meta: {
              kind: 'order-escrow',
              phase: 'buyer_refund',
              refundReason: 'seller-confirmed-return',
              shippingCostExcluded: shippingCost,
              verificationFeeExcluded: verificationChargedToBuyer,
              description: 'بازگشت وجه مرجوعی به خریدار (بدون هزینه ارسال و کارشناسی پرداخت‌شده)',
            },
          },
        });
      }

      const updated = await tx.order.findUnique({ where: { id: order.id } });
      if (!updated) throw new NotFoundException('سفارش یافت نشد');

      await tx.listing.update({
        where: { id: order.listingId },
        data: { status: ListingStatus.APPROVED },
      });

      await tx.notification.createMany({
        data: [
          {
            userId: order.buyerId,
            type: NotificationType.ORDER_STATUS_CHANGED,
            title: 'مرجوعی تایید شد و وجه بازگشت',
            message: `فروشنده دریافت مرجوعی سفارش #${order.id.slice(-6)} را تایید کرد و مبلغ به کیف پول شما برگشت.`,
            meta: {
              orderId: order.id,
              status: OrderStatus.CANCELLED,
              refundAmount: refundableToBuyer,
            } as Prisma.InputJsonValue,
          },
          {
            userId: order.sellerId,
            type: NotificationType.ORDER_STATUS_CHANGED,
            title: 'مرجوعی تایید شد',
            message: `شما دریافت مرجوعی سفارش #${order.id.slice(-6)} را تایید کردید و پرونده بسته شد.`,
            meta: {
              orderId: order.id,
              status: OrderStatus.CANCELLED,
            } as Prisma.InputJsonValue,
          },
        ],
      });

      return {
        success: true,
        message: 'مرجوعی تایید شد و بازگشت وجه انجام شد',
        order: updated,
      };
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
            { orderId: order.id },
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
          { orderId: order.id },
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
      if (exchangeOffer) {
        const verification = Number(order.verificationFee || 0);
        const extra = Number(exchangeOffer.extraPayment || 0);
        const buyerDue = verification + (exchangeOffer.isPayerMe ? extra : 0);
        const sellerDue = verification + (!exchangeOffer.isPayerMe ? extra : 0);
        const paidTotal = Number(order.totalAmount || 0);

        const buyerMarkedPaid = Boolean(order.shippingAddress);
        const sellerMarkedPaid = Boolean(order.sellerShippingAddress);
        const bothSidesMarked = buyerMarkedPaid && sellerMarkedPaid;

        const buyerPaid = bothSidesMarked
          ? buyerDue
          : buyerMarkedPaid
            ? Math.min(buyerDue, paidTotal)
            : 0;
        const sellerPaid = bothSidesMarked
          ? sellerDue
          : sellerMarkedPaid
            ? Math.min(sellerDue, paidTotal)
            : 0;

        (order as any).exchangeEscrow = {
          buyerDue,
          sellerDue,
          buyerPaid,
          sellerPaid,
          buyerBlocked: Math.max(0, buyerDue - buyerPaid),
          sellerBlocked: Math.max(0, sellerDue - sellerPaid),
          totalDue: buyerDue + sellerDue,
          totalPaid: paidTotal,
        };
      }
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

    // توضیح اختیاری «ارسال از هاب» — کوئری Json در برخی دیتابیس‌ها/داده‌های قدیمی ممکن است خطا بدهد؛ در آن صورت جزئیات سفارش را همچنان برمی‌گردانیم.
    let hubShipmentNote: string | null = null;
    let hubShipmentNotedAt: Date | null = null;
    try {
      const hubShipmentNotification = await this.prisma.notification.findFirst({
        where: {
          userId,
          type: NotificationType.ORDER_STATUS_CHANGED,
          AND: [
            {
              meta: {
                path: ['orderId'],
                equals: orderId,
              },
            },
            {
              meta: {
                path: ['status'],
                equals: OrderStatus.SHIPPED_TO_BUYER,
              },
            },
          ],
        },
        orderBy: { createdAt: 'desc' },
        select: { meta: true, createdAt: true },
      });
      const hubShipmentNoteRaw = (hubShipmentNotification?.meta as Record<string, unknown> | null)?.['note'];
      hubShipmentNote =
        typeof hubShipmentNoteRaw === 'string' && hubShipmentNoteRaw.trim().length > 0
          ? hubShipmentNoteRaw.trim()
          : null;
      hubShipmentNotedAt = hubShipmentNotification?.createdAt ?? null;
    } catch {
      hubShipmentNote = null;
      hubShipmentNotedAt = null;
    }
    if (hubShipmentNote) {
      (order as any).hubShipmentNote = hubShipmentNote;
      (order as any).hubShipmentNotedAt = hubShipmentNotedAt;
    }

    const needsHub = order.requiresVerification || order.type === 'EXCHANGE';
    const isSellerView = order.sellerId === userId;
    const isBuyerView = order.buyerId === userId;

    // شماره تلفن طرف مقابل فقط بعد از SHIPPED/DELIVERED (یعنی نیاز واقعی
    // ارتباط هست) قابل مشاهده‌ست. قبل از اون، شماره حذف میشه.
    const contactReleased =
      order.status === 'SHIPPED' || order.status === 'DELIVERED' ||
      order.status === 'COMPLETED' || order.status === 'DISPUTED' ||
      order.status === OrderStatus.RETURN_REQUESTED || order.status === OrderStatus.RETURN_SHIPPED;

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
      if (
        order.status !== OrderStatus.SHIPPED &&
        order.status !== OrderStatus.DELIVERED &&
        order.status !== OrderStatus.SHIPPED_TO_BUYER
      ) {
        throw new BadRequestException('وضعیت سفارش برای شکایت مناسب نیست');
      }

      // اگر سفارش از مسیر کارشناسی با موفقیت عبور کرده باشد، ثبت شکایت در این فاز مجاز نیست.
      const wasInspectedAndApproved =
        Boolean(order.requiresVerification || order.listing?.sellerRequiresVerification) &&
        [
          OrderStatus.SHIPPED_TO_BUYER,
          OrderStatus.SHIPPED,
          OrderStatus.DELIVERED,
        ].includes(order.status);
      if (wasInspectedAndApproved) {
        throw new BadRequestException('برای سفارش کارشناسی‌شده و ارسال‌شده، امکان ثبت شکایت وجود ندارد');
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

      const createdTicket = await tx.ticket.create({
        data: {
          userId: buyerId,
          subject: `شکایت سفارش #${order.id.slice(-6)}`,
          status: 'OPEN',
          messages: {
            create: { senderRole: 'USER', message: ticketMessage }
          }
        },
        select: { id: true },
      });

      await tx.notification.createMany({
        data: [
          {
            userId: buyerId,
            type: NotificationType.ORDER_STATUS_CHANGED,
            title: 'شکایت شما ثبت شد',
            message: `شکایت سفارش #${order.id.slice(-6)} ثبت شد و برای پشتیبانی ارسال گردید.`,
            meta: {
              orderId: order.id,
              ticketId: createdTicket.id,
              status: OrderStatus.DISPUTED,
            } as Prisma.InputJsonValue,
          },
          {
            userId: order.sellerId,
            type: NotificationType.ORDER_STATUS_CHANGED,
            title: 'برای سفارش شما شکایت ثبت شد',
            message: `خریدار برای سفارش #${order.id.slice(-6)} شکایت ثبت کرده است.`,
            meta: {
              orderId: order.id,
              status: OrderStatus.DISPUTED,
            } as Prisma.InputJsonValue,
          },
        ],
      });

      return {
        success: true,
        message: 'شکایت شما ثبت شد و مبلغ مسدود ماند.',
        ticketId: createdTicket.id,
      };
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
          const exchangeOnlyOneSent = order.type === OrderType.EXCHANGE && (sellerSent !== buyerSentForExchange);

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

          if (order.type === OrderType.EXCHANGE && exchangeOnlyOneSent) {
            const offenderId = sellerSent ? order.buyerId : order.sellerId;
            await tx.user.update({
              where: { id: offenderId },
              data: { trustScore: { decrement: 15 } },
            });
          } else {
            await tx.user.update({
              where: { id: order.sellerId },
              data: { trustScore: { decrement: 15 } },
            });
          }
          this.stateMachine.assertTransition(order.status, OrderStatus.CANCELLED, 'auto-cancel-expired');
          await tx.order.update({
            where: { id: order.id },
            data: {
              status: OrderStatus.CANCELLED,
              cancelReason:
                order.type === OrderType.EXCHANGE && exchangeOnlyOneSent
                  ? 'عدم ارسال یکی از طرفین در مهلت ۴۸ ساعته پس از ارسال طرف مقابل؛ مرجوعی کالای ارسال‌شده الزامی است'
                  : 'عدم ارسال در مهلت مقرر',
            },
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
  async autoCancelTimedOutExchangeCompletions() {
    const now = Date.now();
    const timedOutAcceptedOffers = await this.prisma.exchangeOffer.findMany({
      where: {
        status: 'ACCEPTED',
      },
      include: {
        listing: {
          select: { id: true, title: true, status: true },
        },
      },
    });

    for (const offer of timedOutAcceptedOffers) {
      try {
        await this.prisma.$transaction(async (tx) => {
          const linkedOrder = await tx.order.findFirst({
            where: { exchangeOfferId: offer.id },
          });

          if (linkedOrder && linkedOrder.status !== OrderStatus.AWAITING_PAYMENT && linkedOrder.status !== OrderStatus.PENDING) {
            return;
          }

          const verificationFee = Number(linkedOrder?.verificationFee || 0);
          const extra = Number(offer.extraPayment || 0);
          const buyerShare = verificationFee + (offer.isPayerMe ? extra : 0);
          const sellerShare = verificationFee + (!offer.isPayerMe ? extra : 0);
          const buyerRefundable = Math.max(0, buyerShare - verificationFee);
          const sellerRefundable = Math.max(0, sellerShare - verificationFee);
          const expectedTotal = buyerShare + sellerShare;
          const currentTotal = Number(linkedOrder?.totalAmount || 0);

          const buyerAddressProvided = Boolean(linkedOrder?.shippingAddress);
          const sellerAddressProvided = Boolean(linkedOrder?.sellerShippingAddress);
          const noOneStartedCheckout = !linkedOrder || (!buyerAddressProvided && !sellerAddressProvided && currentTotal <= 0);
          const oneSideProgressed =
            !!linkedOrder &&
            (buyerAddressProvided || sellerAddressProvided || currentTotal > 0) &&
            currentTotal < expectedTotal;

          const noPaymentDeadlineMs =
            new Date(offer.updatedAt).getTime() +
            OrdersService.EXCHANGE_NO_PAYMENT_TIMEOUT_HOURS * 60 * 60 * 1000;
          const secondPaymentDeadlineMs = linkedOrder
            ? new Date(linkedOrder.updatedAt).getTime() +
              OrdersService.EXCHANGE_SECOND_PAYMENT_TIMEOUT_HOURS * 60 * 60 * 1000
            : 0;

          const shouldCancelForNoPayment = noOneStartedCheckout && now >= noPaymentDeadlineMs;
          const shouldCancelForSecondPaymentDelay = oneSideProgressed && now >= secondPaymentDeadlineMs;
          if (!shouldCancelForNoPayment && !shouldCancelForSecondPaymentDelay) {
            return;
          }

          if (linkedOrder?.shippingAddress && buyerRefundable > 0) {
            await tx.wallet.upsert({
              where: { userId: linkedOrder.buyerId },
              create: {
                userId: linkedOrder.buyerId,
                balanceAvailable: buyerRefundable,
                balanceBlocked: 0,
              },
              update: {
                balanceAvailable: { increment: buyerRefundable },
              },
            });
            await tx.walletTransaction.create({
              data: {
                wallet: { connect: { userId: linkedOrder.buyerId } },
                amount: buyerRefundable,
                type: WalletTransactionType.DEPOSIT,
                status: WalletTransactionStatus.SUCCESS,
                referenceId: linkedOrder.id,
                meta: {
                  kind: 'exchange-timeout-refund',
                  description:
                    'بازگشت وجه به‌دلیل عدم تکمیل معاوضه در مهلت ۴۸ ساعته (بدون عودت کارشناسی)',
                },
              },
            });
          }

          if (linkedOrder?.sellerShippingAddress && sellerRefundable > 0) {
            await tx.wallet.upsert({
              where: { userId: linkedOrder.sellerId },
              create: {
                userId: linkedOrder.sellerId,
                balanceAvailable: sellerRefundable,
                balanceBlocked: 0,
              },
              update: {
                balanceAvailable: { increment: sellerRefundable },
              },
            });
            await tx.walletTransaction.create({
              data: {
                wallet: { connect: { userId: linkedOrder.sellerId } },
                amount: sellerRefundable,
                type: WalletTransactionType.DEPOSIT,
                status: WalletTransactionStatus.SUCCESS,
                referenceId: linkedOrder.id,
                meta: {
                  kind: 'exchange-timeout-refund',
                  description:
                    'بازگشت وجه به‌دلیل عدم تکمیل معاوضه در مهلت ۴۸ ساعته (بدون عودت کارشناسی)',
                },
              },
            });
          }

          if (linkedOrder) {
            let payerToPenalize: string | null = null;
            if (shouldCancelForSecondPaymentDelay) {
              if (linkedOrder.shippingAddress && !linkedOrder.sellerShippingAddress) {
                payerToPenalize = linkedOrder.sellerId;
              } else if (linkedOrder.sellerShippingAddress && !linkedOrder.shippingAddress) {
                payerToPenalize = linkedOrder.buyerId;
              }
            }
            if (payerToPenalize) {
              await tx.user.update({
                where: { id: payerToPenalize },
                data: { trustScore: { decrement: 10 } },
              });
            }
            await tx.order.update({
              where: { id: linkedOrder.id },
              data: {
                status: OrderStatus.CANCELLED,
                cancelReason: shouldCancelForNoPayment
                  ? 'تا ۲۴ ساعت پس از پذیرش معاوضه هیچ پرداختی انجام نشد'
                  : 'پس از پرداخت نفر اول، طرف مقابل در مهلت ۴۸ ساعته پرداخت را تکمیل نکرد',
              },
            });
          }

          await tx.exchangeOffer.update({
            where: { id: offer.id },
            data: { status: 'REJECTED' },
          });

          await tx.listing.update({
            where: { id: offer.listingId },
            data: { status: ListingStatus.APPROVED },
          });

          const rejectedOffers = await tx.exchangeOffer.findMany({
            where: {
              listingId: offer.listingId,
              id: { not: offer.id },
              status: 'REJECTED',
            },
            select: { offererId: true },
          });
          const uniqueOffererIds = [...new Set(rejectedOffers.map((x) => x.offererId))];
          if (uniqueOffererIds.length > 0) {
            await tx.notification.createMany({
              data: uniqueOffererIds.map((uid) => ({
                userId: uid,
                type: NotificationType.SYSTEM,
                title: 'آگهی دوباره برای معاوضه فعال شد',
                message: `مهلت تکمیل معاوضه برای «${offer.listing?.title ?? 'این آگهی'}» تمام شد و می‌توانید دوباره درخواست ثبت کنید.`,
                meta: {
                  listingId: offer.listingId,
                  reason: 'exchange-timeout',
                } as Prisma.InputJsonValue,
              })),
            });
          }
        });
      } catch (error) {
        console.error(`Error auto-canceling exchange timeout for offer ${offer.id}:`, error);
      }
    }
  }

  @Cron(CronExpression.EVERY_HOUR)
  async autoConfirmOrders() {
    const buyerConfirmDeadlineMinutes = await this.getBuyerConfirmDeadlineMinutes();
    const threshold = new Date(
      Date.now() - buyerConfirmDeadlineMinutes * 60 * 1000,
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
                { orderId: locked.id },
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

  private async getBuyerConfirmDeadlineMinutes(): Promise<number> {
    const setting = await this.prisma.systemSetting.findFirst({
      where: { key: { in: ['BUYER_CONFIRM_DEADLINE_MINUTES', 'BUYER_CONFIRM_DEADLINE_DAYS'] } },
      orderBy: { key: 'asc' },
    });
    return this.parsePositiveIntSetting(
      setting?.value,
      OrdersService.DEFAULT_BUYER_CONFIRM_DEADLINE_MINUTES,
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

  private async notifyOrderPurchasedAndSold(order: {
    id: string;
    buyerId: string;
    sellerId: string;
    listingId: string;
  }): Promise<void> {
    const listing = await this.prisma.listing.findUnique({
      where: { id: order.listingId },
      select: { title: true },
    });
    const listingTitle = listing?.title ?? 'کالا';

    await Promise.all([
      this.notificationService.create({
        userId: order.buyerId,
        type: NotificationType.ORDER_STATUS_CHANGED,
        title: 'خرید شما ثبت شد',
        message: `خرید شما برای «${listingTitle}» با موفقیت ثبت شد.`,
        meta: {
          orderId: order.id,
          listingId: order.listingId,
          role: 'BUYER',
          status: 'PAID',
        },
      }),
      this.notificationService.create({
        userId: order.sellerId,
        type: NotificationType.ORDER_STATUS_CHANGED,
        title: 'کالای شما فروخته شد',
        message: `کالای «${listingTitle}» با موفقیت فروخته شد.`,
        meta: {
          orderId: order.id,
          listingId: order.listingId,
          role: 'SELLER',
          status: 'SOLD',
        },
      }),
    ]);
  }
}