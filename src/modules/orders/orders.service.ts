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
  ExchangeOfferStatus,
  ListingType,
  OrderStatus,
  OrderType,
  SecondChanceOfferStatus,
  ListingStatus,
  NotificationType,
  UserRole,
  Prisma,
  WalletTransactionStatus,
  WalletTransactionType,
} from '@prisma/client';
import { Cron, CronExpression } from '@nestjs/schedule';
import { WalletService } from '../wallet/wallet.service';
import { FeeCalculatorService } from '../fees/fee-calculator.service';
import Decimal from 'decimal.js';
import { OrdersStateMachineService } from './orders-state-machine.service';
import { AppSettingsService } from '../../shared/settings/app-settings.service';
import { PaymentsService } from '../payments/payments.service';
import { NotificationService } from '../notification/notification.service';
import { OrderReputationService } from './order-reputation.service';
import { ExchangeService } from '../exchange/exchange.service';
import { QuotaService } from '../quota/quota.service';
import { ListingCommandService } from '../listing/services/listing-command.service';

@Injectable()
export class OrdersService {
  private static readonly DEFAULT_SELLER_SHIP_DEADLINE_MINUTES = 3 * 24 * 60;
  private static readonly DEFAULT_BUYER_CONFIRM_DEADLINE_MINUTES = 4 * 24 * 60;
  private static readonly DEFAULT_EXCHANGE_NO_SHIPMENT_COMPENSATION = 20;
  private static readonly DEFAULT_EXCHANGE_NO_PAYMENT_TIMEOUT_HOURS = 24;
  private static readonly DEFAULT_EXCHANGE_PAYMENT_DEADLINE_MINUTES = 24 * 60;
  private static readonly DEFAULT_EXCHANGE_SECOND_PAYMENT_TIMEOUT_HOURS = 48;
  private static readonly EXCHANGE_PAYMENT_TIMEOUT_TRUST_PENALTY = 15;
  private static readonly DEFAULT_EXCHANGE_SHIPMENT_TIMEOUT_HOURS = 48;
  private static readonly DEFAULT_EXCHANGE_RETURN_CONFIRM_DEADLINE_MINUTES =
    48 * 60;

  constructor(
    private readonly prisma: PrismaService,
    private readonly walletService: WalletService,
    private readonly feeCalculator: FeeCalculatorService,
    private readonly appSettings: AppSettingsService,
    private readonly stateMachine: OrdersStateMachineService,
    private readonly paymentsService: PaymentsService,
    private readonly notificationService: NotificationService,
    private readonly orderReputation: OrderReputationService,
    private readonly exchangeService: ExchangeService,
    private readonly quotaService: QuotaService,
    private readonly listingCommand: ListingCommandService,
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
      if (item.type !== OrderType.EXCHANGE || !item.exchangeOfferId) {
        return item;
      }
      const offer = exchangeOfferById.get(item.exchangeOfferId);
      const verificationFee = Number((item as any).verificationFee || 0);
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
        where: {
          OR: [{ offererId: userId }, { listing: { authorId: userId } }],
        },
        skip,
        take: pageSize,
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
    const orderByOfferId = new Map(
      linkedOrders.map((o) => [o.exchangeOfferId, o]),
    );
    const exchangeOffersWithPaymentState = exchangeOffers.map((offer) => {
      const linked = orderByOfferId.get(offer.id);
      const isOfferer = offer.offererId === userId;
      const mySharePaid = isOfferer
        ? Boolean(linked?.shippingAddress)
        : Boolean(linked?.sellerShippingAddress);
      return {
        ...offer,
        isOfferer,
        exchangeOrderId: linked?.id ?? null,
        exchangeOrderStatus: linked?.status ?? null,
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
      requiresVerification,
    } = dto;

    const finalExchangeId = exchangeOfferId || exchangeRequestId;
    let listingId = dto.listingId;
    let paymentUrl = null;

    const order = await this.prisma.$transaction(async (tx) => {
      let finalPrice = 0;
      let shippingCost = 0;
      let sellerId = '';
      const buyerId = userId;
      let categoryId = '';
      let verificationFee = 0;
      let platformAddress = null;
      let sellerRequestedVerification = false;
      let auctionBlockedDeposit = 0;
      let auctionWinnerBidId: string | null = null;

      const feeSetting = await tx.systemSetting.findUnique({
        where: { key: 'VERIFICATION_FEE' },
      });
      const shippingSetting = await tx.systemSetting.findUnique({
        where: { key: 'SHIPPING_COST' },
      });
      const sellerShipDeadlineSetting = await tx.systemSetting.findFirst({
        where: {
          key: {
            in: ['SELLER_SHIP_DEADLINE_MINUTES', 'SELLER_SHIP_DEADLINE_DAYS'],
          },
        },
      });
      const addressSetting = await tx.systemSetting.findUnique({
        where: { key: 'PLATFORM_ADDRESS' },
      });
      const hubAddress = addressSetting
        ? addressSetting.value
        : 'تهران، دفتر مرکزی پردازش و کارشناسی طبقه';
      const hubFee = feeSetting ? Number(feeSetting.value) : 250000;
      const shippingFee = shippingSetting
        ? Number(shippingSetting.value)
        : 50000;
      const sellerShipDeadlineMinutes = this.parsePositiveIntSetting(
        sellerShipDeadlineSetting?.value,
        OrdersService.DEFAULT_SELLER_SHIP_DEADLINE_MINUTES,
      );

      // -----------------------------------------------------
      // سناریو ۱: معاوضه (پشتیبانی از پرداخت دوطرفه)
      // -----------------------------------------------------
      if (orderType === 'EXCHANGE') {
        const exchangeShipDeadlineMinutes =
          await this.getExchangeShipmentDeadlineMinutes();
        const offer = await tx.exchangeOffer.findUnique({
          where: { id: finalExchangeId },
          include: { listing: { include: { direct: true } } },
        });

        if (!offer) throw new NotFoundException('درخواست معاوضه یافت نشد');
        if (offer.status !== 'ACCEPTED')
          throw new BadRequestException('این معاوضه هنوز تایید نشده است');

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

          const otherUserId = isBuyer
            ? offer.listing.authorId
            : offer.offererId;
          const peerEscrowAmount = Math.max(0, totalPayable - verificationFee);

          await this.walletService.transferToEscrow(
            userId,
            otherUserId,
            totalPayable,
            0,
            listingId,
            tx,
            { isExchangeEscrow: true, blockedAmount: peerEscrowAmount },
          );
        }

        // پردازش آدرس شخصی که الان داره چک‌اوت میکنه
        let currentAddressStr = null;
        let currentPhone = null;
        let currentPostal = null;
        if (addressId) {
          const fetchedAddress = await tx.address.findUnique({
            where: { id: addressId },
          });
          if (fetchedAddress) {
            currentAddressStr = `${fetchedAddress.province}، ${fetchedAddress.city}، ${fetchedAddress.fullAddress}`;
            currentPhone = fetchedAddress.phone;
            currentPostal = fetchedAddress.postalCode;
          }
        }

        // 🔍 بررسی اینکه آیا طرف مقابل قبلاً سفارش را ایجاد کرده است یا نه؟
        const existingExchangeOrder = await tx.order.findFirst({
          where: { exchangeOfferId: finalExchangeId },
        });

        if (existingExchangeOrder) {
          const updateData: any = {};
          const verificationFeePerSide = Number(
            existingExchangeOrder.verificationFee || 0,
          );
          const extraPayment = Number(offer.extraPayment || 0);
          const buyerDue =
            verificationFeePerSide + (offer.isPayerMe ? extraPayment : 0);
          const sellerDue =
            verificationFeePerSide + (!offer.isPayerMe ? extraPayment : 0);
          const expectedTotal = buyerDue + sellerDue;
          const currentTotal = Number(existingExchangeOrder.totalAmount || 0);
          const isExchangeIncomplete = currentTotal < expectedTotal;

          if (isBuyer) {
            // اگر تسویه کامل نشده باشد، وجود آدرس به معنی پرداخت قطعی نیست
            // (ممکن است attempt قبلی ناموفق/ناتمام بوده باشد).
            if (
              existingExchangeOrder.shippingAddress &&
              !isExchangeIncomplete
            ) {
              throw new BadRequestException(
                'شما قبلاً پرداخت خود را انجام داده‌اید',
              );
            }
            updateData.shippingAddress = currentAddressStr;
            updateData.shippingPhone = currentPhone;
            updateData.shippingPostalCode = currentPostal;
          } else {
            if (
              existingExchangeOrder.sellerShippingAddress &&
              !isExchangeIncomplete
            ) {
              throw new BadRequestException(
                'شما قبلاً پرداخت خود را انجام داده‌اید',
              );
            }
            updateData.sellerShippingAddress = currentAddressStr;
            updateData.sellerShippingPhone = currentPhone;
            updateData.sellerShippingPostalCode = currentPostal;
          }

          // در کیف پول، مبلغ همین لحظه واقعاً پرداخت می‌شود؛ در درگاه بعد از callback.
          if (paymentMethod === 'WALLET') {
            updateData.totalAmount =
              Number(existingExchangeOrder.totalAmount) + totalPayable;
          }
          if (isExchangeIncomplete) {
            updateData.status = OrderStatus.AWAITING_PAYMENT;
          }
          if (orderType !== 'EXCHANGE') {
            updateData.paymentMethod = paymentMethod;
          }
          const updatedOrder = await tx.order.update({
            where: { id: existingExchangeOrder.id },
            data: updateData,
          });

          const bothSidesProvidedAddress =
            !!updatedOrder.shippingAddress &&
            !!updatedOrder.sellerShippingAddress;
          if (bothSidesProvidedAddress && paymentMethod === 'WALLET') {
            const deadline = new Date(
              Date.now() + exchangeShipDeadlineMinutes * 60 * 1000,
            );
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
            await this.exchangeService.rejectNonWinningExchangeOffersAfterSale(
              tx,
              listingId,
              finalExchangeId,
            );
          }

          return updatedOrder;
        } else {
          // ✨ نفر اولی است که چک‌اوت می‌کند، پس سفارش را می‌سازیم

          // 🎯 حل مشکل کارمزد: همیشه کل مبلغ سرک (مابه‌التفاوت) را ملاک محاسبه قرار می‌دهیم
          const totalExchangeExtraPayment = Number(offer.extraPayment || 0);

          // محاسبه کارمزد روی کل مبلغ سرک
          const platformCommission = 0;

          // دریافتی نهایی (در صورت وجود مابه‌التفاوت) منهای کارمزد شما
          const sellerRev = offer.isPayerMe
            ? new Decimal(totalExchangeExtraPayment)
                .minus(platformCommission)
                .toString()
            : '0';

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
        if (!listing || !listing.auction) {
          throw new BadRequestException('اطلاعات مزایده یافت نشد');
        }
        if (listing.auction.status !== AuctionStatus.FINISHED) {
          throw new BadRequestException('این مزایده هنوز نهایی نشده است');
        }
        if (
          listing.auction.settlementStatus !== AuctionSettlementStatus.PENDING
        ) {
          throw new BadRequestException(
            'وضعیت تسویه این مزایده قابل پرداخت نیست',
          );
        }
        if (listing.auction.highestBidderId !== userId) {
          throw new ForbiddenException(
            'فقط برنده فعلی مزایده می‌تواند پرداخت و سفارش را نهایی کند',
          );
        }
        // اگر این پرداخت در پنجره شانس دوم باشد، باید پیشنهاد رسمی شانس دوم وجود داشته باشد و همان لحظه ACCEPTED شود.
        const now = new Date();
        const finishedAt = listing.auction.finishedAt
          ? new Date(listing.auction.finishedAt).getTime()
          : 0;
        const deadlineAt = listing.auction.paymentDeadline
          ? new Date(listing.auction.paymentDeadline).getTime()
          : 0;
        const windowHours =
          finishedAt > 0 && deadlineAt > finishedAt
            ? (deadlineAt - finishedAt) / (60 * 60 * 1000)
            : null;
        const isSecondChanceRound =
          windowHours != null && windowHours <= 24 + 1;

        const offered = await tx.secondChanceOffer.findFirst({
          where: {
            listingId,
            userId,
            status: 'OFFERED',
            expiresAt: { gt: now },
          },
          orderBy: { createdAt: 'desc' },
        });
        if (isSecondChanceRound && !offered) {
          throw new ForbiddenException(
            'این پرداخت فقط با پیشنهاد شانس دوم معتبر امکان‌پذیر است',
          );
        }
        if (offered) {
          const accepted = await tx.secondChanceOffer.updateMany({
            where: {
              id: offered.id,
              status: 'OFFERED',
              expiresAt: { gt: now },
            },
            data: { status: 'ACCEPTED', acceptedAt: now },
          });
          if (!accepted.count) {
            throw new BadRequestException('پیشنهاد شانس دوم دیگر معتبر نیست');
          }
        }

        const winnerBid = listing.auction.bids[0];
        if (winnerBid) {
          auctionWinnerBidId = winnerBid.id;
          finalPrice = Number(winnerBid.amount);
          auctionBlockedDeposit = Math.max(
            0,
            Number(winnerBid.blockedAmount || 0),
          );
        } else if (listing.auction.highestBidAmount != null) {
          auctionWinnerBidId = null;
          finalPrice = Number(listing.auction.highestBidAmount);
          auctionBlockedDeposit = 0;
        } else {
          throw new BadRequestException('اطلاعات مزایده یافت نشد');
        }

        sellerId = listing.authorId;
        categoryId = listing.categoryId;
        if (sellerId === userId)
          throw new ForbiddenException('شما نمی‌توانید آگهی خودتان را بخرید.');

        shippingCost =
          listing.shippingPayer === 'BUYER_PREPAID' ? shippingFee : 0;
        sellerRequestedVerification =
          listing.sellerRequiresVerification || false;
      }
      // -----------------------------------------------------
      // سناریو ۳: خرید مستقیم
      // -----------------------------------------------------
      else {
        const listing = await tx.listing.findUnique({
          where: { id: listingId },
          include: { direct: true },
        });
        if (!listing || listing.status !== 'APPROVED')
          throw new BadRequestException('آگهی یافت نشد یا فروخته شده');

        finalPrice = Number(listing.direct?.price || 0);
        sellerId = listing.authorId;
        categoryId = listing.categoryId;
        if (sellerId === userId)
          throw new ForbiddenException('شما نمی‌توانید آگهی خودتان را بخرید.');

        shippingCost =
          listing.shippingPayer === 'BUYER_PREPAID' ? shippingFee : 0;
        sellerRequestedVerification =
          listing.sellerRequiresVerification || false;
      }

      // --- بررسی سفارش‌های قبلی این آگهی (ضد سوءاستفاده) ---
      // نکته: حذف سفارشِ معلقِ «کاربر دیگر» برای همین آگهی یک سوراخ امنیتی است.
      // فقط سفارش‌های معلق/کنسل‌شده‌ی همین کاربر قابل پاکسازی هستند.
      const existingOrders = await tx.order.findMany({
        where: { listingId },
        select: { id: true, status: true, buyerId: true },
        take: 5,
        orderBy: { createdAt: 'desc' },
      });

      if (existingOrders.length) {
        const someoneElseBlockingCheckout = existingOrders.some(
          (o) =>
            o.buyerId !== buyerId &&
            (o.status === OrderStatus.PENDING ||
              o.status === OrderStatus.AWAITING_PAYMENT),
        );
        if (someoneElseBlockingCheckout) {
          throw new BadRequestException(
            'این کالا در حال پرداخت توسط کاربر دیگری است.',
          );
        }

        const hasActiveNonCancelable = existingOrders.some((o) => {
          if (
            o.status === OrderStatus.PENDING ||
            o.status === OrderStatus.CANCELLED
          ) {
            return false;
          }
          if (
            o.status === OrderStatus.AWAITING_PAYMENT &&
            o.buyerId === buyerId
          ) {
            return false;
          }
          return true;
        });
        if (hasActiveNonCancelable) {
          throw new BadRequestException(
            'این کالا در حال حاضر به فروش رسیده و در جریان است.',
          );
        }

        await tx.order.deleteMany({
          where: {
            listingId,
            buyerId,
            status: {
              in: [
                OrderStatus.PENDING,
                OrderStatus.CANCELLED,
                OrderStatus.AWAITING_PAYMENT,
              ],
            },
          },
        });
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
      const totalPayable =
        orderType === 'AUCTION'
          ? Math.max(0, finalPrice - auctionBlockedDeposit) +
            shippingCost +
            feeChargedToBuyer
          : finalPrice + shippingCost + feeChargedToBuyer;

      const platformFee =
        orderType === 'EXCHANGE'
          ? 0
          : await this.feeCalculator.calculateFee(
              orderType === 'AUCTION'
                ? ListingType.AUCTION
                : ListingType.DIRECT,
              categoryId,
              finalPrice,
              { sellerId },
            );

      // 🎯 لاجیک طلایی واریزی فروشنده
      const sellerRevenue = new Decimal(finalPrice)
        .minus(platformFee)
        .plus(shippingCost)
        .minus(feeChargedToSeller)
        .toString();

      // 👇 متغیر جدید برای سیستم امانی (مجموع کارمزد پلتفرم + هزینه کارشناسی)
      const totalPlatformCut =
        Number(platformFee) + feeChargedToSeller + feeChargedToBuyer;

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
              await this.walletService.unblockAmount(
                bid.bidderId,
                blocked,
                listingId,
                tx,
              );
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

      if (paymentMethod === 'WALLET') {
        // پرداخت از کیف: در همین تراکنش واریزی انجام شده یا مبلغ صفر بوده؛ فروش فقط همین سناریوها قطعی می‌شود.
        if (orderType === 'EXCHANGE' || isHubRequired) {
          orderStatus = 'AWAITING_SHIPMENT_TO_HUB' as OrderStatus;
        } else {
          orderStatus = OrderStatus.PAID;
        }
      } else if (paymentMethod === 'GATEWAY') {
        if (totalPayable > 0) {
          orderStatus = OrderStatus.AWAITING_PAYMENT;
        } else {
          // مانده‌ای برای درگاه نیست (مثلاً مابه‌التفاوت مزایده صفر)، تسویه آنی مانند بدون نیاز به درگاه
          if (orderType === 'EXCHANGE' || isHubRequired) {
            orderStatus = 'AWAITING_SHIPMENT_TO_HUB' as OrderStatus;
          } else {
            orderStatus = OrderStatus.PAID;
          }
        }
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
        requiresVerification: Boolean(
          isHubRequired || orderType === 'EXCHANGE',
        ),
        verificationFee: verificationFee,
        platformAddress: platformAddress,
      };

      if (finalExchangeId) orderPayload.exchangeOfferId = finalExchangeId;

      if (
        orderStatus !== OrderStatus.PENDING &&
        orderStatus !== OrderStatus.AWAITING_PAYMENT
      ) {
        const shipDeadlineMinutes =
          orderType === 'EXCHANGE'
            ? await this.getExchangeShipmentDeadlineMinutes()
            : sellerShipDeadlineMinutes;
        const deadline = new Date(Date.now() + shipDeadlineMinutes * 60 * 1000);
        orderPayload.shippingDeadline = deadline;
      }

      if (addressId) {
        const fetchedAddress = await tx.address.findUnique({
          where: { id: addressId },
        });
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
        await tx.listing.update({
          where: { id: listingId },
          data: { status: ListingStatus.SOLD },
        });
      }

      return createdOrder;
    });

    // در معاوضه، مبلغ قابل پرداخت هر طرف جداگانه در PaymentsService محاسبه می‌شود
    // و ممکن است totalAmount سفارش (در لحظه ساخت/به‌روزرسانی) معیار خوبی نباشد.
    if (
      paymentMethod === 'GATEWAY' &&
      (order.type === OrderType.EXCHANGE || Number(order.totalAmount) > 0)
    ) {
      try {
        const initiated = await this.paymentsService.initiateOrderPayment(
          order.id,
          userId,
        );
        paymentUrl = initiated.paymentUrl;
      } catch (err) {
        await this.releaseOrderAfterFailedGatewayInit(order.id);
        throw err;
      }
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
      paymentUrl: paymentUrl,
    };
  } // 4. ثبت کد رهگیری
  // =================================================================
  async updateTrackingCode(
    userId: string,
    orderId: string,
    trackingCode: string,
    videoPath?: string,
  ) {
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

    if (
      order.status === OrderStatus.CANCELLED ||
      order.status === OrderStatus.REJECTED_AT_HUB
    ) {
      throw new BadRequestException(
        'این سفارش لغو شده و امکان ثبت اطلاعات ارسال وجود ندارد.',
      );
    }

    if (await this.isShippingDeadlineExpired(order)) {
      await this.tryCancelExpiredShippingForOrder(orderId);
      throw new BadRequestException(
        'مهلت ارسال به پایان رسیده است؛ سفارش لغو شده و امکان ثبت اطلاعات ارسال وجود ندارد.',
      );
    }

    const updateData: Prisma.OrderUpdateInput = {};

    if (
      order.type === OrderType.EXCHANGE &&
      (!order.shippingAddress ||
        !order.sellerShippingAddress ||
        !(
          [
            OrderStatus.AWAITING_SHIPMENT_TO_HUB,
            OrderStatus.SHIPPED_TO_HUB,
          ] as OrderStatus[]
        ).includes(order.status))
    ) {
      throw new BadRequestException(
        'ارسال کالا پس از تکمیل پرداخت هر دو طرف فعال می‌شود',
      );
    }

    // منطق هوشمند: آیا کالا باید به هاب برود یا مستقیم به خریدار؟
    const needsHub =
      order.type === OrderType.EXCHANGE ||
      order.requiresVerification ||
      order.listing?.sellerRequiresVerification;

    const nextShipStatus = needsHub
      ? OrderStatus.SHIPPED_TO_HUB
      : OrderStatus.SHIPPED;
    updateData.status = nextShipStatus;
    if (nextShipStatus === OrderStatus.SHIPPED && !order.buyerConfirmDeadline) {
      updateData.buyerConfirmDeadline =
        await this.buildBuyerConfirmDeadlineFrom(new Date());
    }

    // جایگذاری صحیح کد رهگیری و ویدیو بر اساس شخص ارسال‌کننده
    if (isSeller) {
      if (order.trackingCode) {
        throw new BadRequestException(
          'شما قبلاً کد رهگیری این ارسال را ثبت کرده‌اید',
        );
      }
      updateData.trackingCode = trackingCode;
      updateData.packagingVideo = videoPath;
    } else if (order.type === OrderType.EXCHANGE && isBuyer) {
      if (order.sellerTrackingCode) {
        throw new BadRequestException(
          'شما قبلاً کد رهگیری این ارسال را ثبت کرده‌اید',
        );
      }
      updateData.sellerTrackingCode = trackingCode;
      updateData.buyerPackagingVideo = videoPath;
    } else {
      throw new ForbiddenException(
        'شما مجاز به ثبت اطلاعات ارسال برای این سفارش نیستید',
      );
    }

    // در معاوضه: بعد از ثبت اولین ارسال، طرف مقابل ۴۸ ساعت فرصت دارد ارسال خودش را ثبت کند.
    if (order.type === OrderType.EXCHANGE) {
      const sellerTrackingAfter = isSeller ? trackingCode : order.trackingCode;
      const buyerTrackingAfter = isBuyer
        ? trackingCode
        : order.sellerTrackingCode;
      const onlyOneSideShipped =
        Boolean(sellerTrackingAfter) !== Boolean(buyerTrackingAfter);
      if (onlyOneSideShipped) {
        const shipmentDeadlineMinutes =
          await this.getExchangeShipmentDeadlineMinutes();
        updateData.shippingDeadline = new Date(
          Date.now() + shipmentDeadlineMinutes * 60 * 1000,
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

    const order = await this.prisma.order.findUnique({
      where: { id: orderId },
    });
    if (!order) throw new NotFoundException('سفارش یافت نشد');
    if (order.type === OrderType.EXCHANGE) {
      throw new BadRequestException(
        'ثبت مرجوعی برای سفارش معاوضه در این مرحله مجاز نیست',
      );
    }
    if (order.buyerId !== userId) {
      throw new ForbiddenException('فقط خریدار می‌تواند مرجوعی را ثبت کند');
    }
    if (order.status !== OrderStatus.RETURN_REQUESTED) {
      throw new BadRequestException(
        'این سفارش در وضعیت مناسب برای ثبت مرجوعی نیست',
      );
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
        include: {
          listing: {
            select: { title: true, sellerRequiresVerification: true },
          },
        },
      });
      if (!order) throw new NotFoundException('سفارش یافت نشد');
      if (order.sellerId !== sellerId) {
        throw new ForbiddenException(
          'فقط فروشنده می‌تواند دریافت مرجوعی را تایید کند',
        );
      }
      if (order.type === OrderType.EXCHANGE) {
        throw new BadRequestException(
          'تایید مرجوعی برای سفارش معاوضه در این مرحله مجاز نیست',
        );
      }
      if (order.status !== OrderStatus.RETURN_SHIPPED) {
        throw new BadRequestException(
          'این سفارش در وضعیت مناسب برای تایید مرجوعی نیست',
        );
      }

      this.stateMachine.assertTransition(
        order.status,
        OrderStatus.CANCELLED,
        'confirm-return-receipt',
      );

      const sellerRevenue = Number(order.sellerRevenue || 0);
      const totalAmount = Number(order.totalAmount || 0);
      const shippingCost = Number(order.shippingCost || 0);
      const verificationFee = Number(order.verificationFee || 0);
      const verificationChargedToBuyer =
        order.requiresVerification && !order.listing?.sellerRequiresVerification
          ? verificationFee
          : 0;
      const refundableToBuyer = Math.max(
        0,
        totalAmount - shippingCost - verificationChargedToBuyer,
      );

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
          cancelReason:
            'مرجوعی توسط فروشنده تحویل گرفته شد و بازگشت وجه انجام شد',
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
          throw new BadRequestException(
            'مرجوعی قبلاً تایید شده و بازگشت وجه ثبت شده است',
          );
        }
        throw new BadRequestException(
          'این سفارش در وضعیت مناسب برای تایید مرجوعی نیست',
        );
      }

      await this.orderReputation.recordTerminalOutcome(
        tx,
        {
          id: order.id,
          buyerId: order.buyerId,
          sellerId: order.sellerId,
          tradeReputationAt: order.tradeReputationAt,
        },
        OrderStatus.RETURN_SHIPPED,
        'FAILURE',
      );

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
              description:
                'کسر از موجودی بلوکه فروشنده پس از تایید دریافت مرجوعی',
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
              description:
                'بازگشت وجه مرجوعی به خریدار (بدون هزینه ارسال و کارشناسی پرداخت‌شده)',
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
        const inspection =
          (order.exchangeHubInspection as Record<string, unknown> | null) ??
          null;
        const isReturnBothFlow =
          inspection?.['resolution'] === 'RETURN_BOTH_TO_SENDERS' &&
          (order.status === OrderStatus.CANCELLED ||
            order.status === OrderStatus.REJECTED_AT_HUB);
        const refundableAlreadyReleased = Boolean(
          inspection?.['refundsReleasedAt'],
        );

        if (!isReturnBothFlow) {
          this.stateMachine.assertTransition(
            order.status,
            OrderStatus.COMPLETED,
            'confirm-order-exchange',
          );
        }

        if (isReturnBothFlow) {
          if (refundableAlreadyReleased) {
            throw new BadRequestException(
              'بازگشت وجه این مرجوعی قبلاً انجام شده است',
            );
          }

          if (isBuyer) {
            if (!order.hubToBuyerTrackingCode?.trim()) {
              throw new BadRequestException(
                'تا زمان ثبت کد رهگیری مرجوعی کالای شما، امکان تایید دریافت وجود ندارد.',
              );
            }
            if (order.buyerConfirmedDelivery) {
              throw new BadRequestException(
                'شما قبلاً دریافت کالای مرجوعی خود را تایید کرده‌اید',
              );
            }
          }
          if (isSeller) {
            if (!order.hubToSellerTrackingCode?.trim()) {
              throw new BadRequestException(
                'تا زمان ثبت کد رهگیری مرجوعی کالای شما، امکان تایید دریافت وجود ندارد.',
              );
            }
            if (order.sellerConfirmedDelivery) {
              throw new BadRequestException(
                'شما قبلاً دریافت کالای مرجوعی خود را تایید کرده‌اید',
              );
            }
          }

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
            const mergedInspection = {
              ...inspection,
              buyerReturnReceived: Boolean(
                afterAck.buyerConfirmedDelivery || isBuyer,
              ),
              sellerReturnReceived: Boolean(
                afterAck.sellerConfirmedDelivery || isSeller,
              ),
              awaitingReturnConfirmations: true,
            };
            return tx.order.update({
              where: { id: orderId },
              data: {
                exchangeHubInspection:
                  mergedInspection as Prisma.InputJsonValue,
              },
            });
          }

          const exchangeOffer = order.exchangeOfferId
            ? await tx.exchangeOffer.findUnique({
                where: { id: order.exchangeOfferId },
                select: { extraPayment: true, isPayerMe: true },
              })
            : null;
          const verificationFee = Number(order.verificationFee || 0);
          const extra = Number(exchangeOffer?.extraPayment || 0);
          const buyerShare =
            verificationFee + (exchangeOffer?.isPayerMe ? extra : 0);
          const sellerShare =
            verificationFee + (!exchangeOffer?.isPayerMe ? extra : 0);
          const buyerRefundable = Math.max(0, buyerShare - verificationFee);
          const sellerRefundable = Math.max(0, sellerShare - verificationFee);

          await this.walletService.refundExchangeExtraOnCancel(tx, {
            buyerId: order.buyerId,
            sellerId: order.sellerId,
            listingId: order.listingId,
            orderId: order.id,
            isPayerMe: Boolean(exchangeOffer?.isPayerMe),
            buyerRefundable,
            sellerRefundable,
          });

          const mergedInspection = {
            ...inspection,
            buyerReturnReceived: true,
            sellerReturnReceived: true,
            awaitingReturnConfirmations: false,
            refundsReleasedAt: new Date().toISOString(),
          };
          return tx.order.update({
            where: { id: orderId },
            data: {
              exchangeHubInspection: mergedInspection as Prisma.InputJsonValue,
              returnConfirmedAt: new Date(),
              returnConfirmedBy: 'BOTH_PARTIES',
              cancelReason: [
                order.cancelReason ?? 'مرجوعی دوطرفه معاوضه',
                'دریافت مرجوعی توسط هر دو طرف تایید شد و سهم پرداختی (بدون هزینه کارشناسی) آزاد شد.',
              ]
                .filter(Boolean)
                .join('\n'),
            },
          });
        }

        const hubShipped =
          order.status === OrderStatus.SHIPPED_TO_BUYER ||
          order.status === OrderStatus.SHIPPED ||
          order.status === OrderStatus.DELIVERED;
        if (!hubShipped) {
          throw new BadRequestException(
            'هنوز مرحله ارسال کالا از هاب به مقصد نهایی تکمیل نشده؛ امکان تایید دریافت نیست.',
          );
        }
        if (isBuyer) {
          if (!order.hubToBuyerTrackingCode?.trim()) {
            throw new BadRequestException(
              'تا زمان ثبت کد رهگیری ارسال کالای شما از هاب، امکان تایید دریافت وجود ندارد.',
            );
          }
          if (order.buyerConfirmedDelivery) {
            throw new BadRequestException(
              'شما قبلاً دریافت کالای خود را تایید کرده‌اید',
            );
          }
        }
        if (isSeller) {
          if (!order.hubToSellerTrackingCode?.trim()) {
            throw new BadRequestException(
              'تا زمان ثبت کد رهگیری ارسال کالای شما از هاب، امکان تایید دریافت وجود ندارد.',
            );
          }
          if (order.sellerConfirmedDelivery) {
            throw new BadRequestException(
              'شما قبلاً دریافت کالای خود را تایید کرده‌اید',
            );
          }
        }

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

        // در معاوضه، برای جلوگیری از دوبار واریز، فقط همان مبالغی را آزاد می‌کنیم
        // که واقعاً هنوز در کیف پول کاربران در حالت بلوکه مانده‌اند.
        const [sellerWallet, buyerWallet] = await Promise.all([
          tx.wallet.findUnique({
            where: { userId: order.sellerId },
            select: { balanceBlocked: true },
          }),
          tx.wallet.findUnique({
            where: { userId: order.buyerId },
            select: { balanceBlocked: true },
          }),
        ]);
        const sellerBlocked = Math.max(
          0,
          Number(sellerWallet?.balanceBlocked || 0),
        );
        const buyerBlocked = Math.max(
          0,
          Number(buyerWallet?.balanceBlocked || 0),
        );
        const sellerRelease = sellerBlocked;
        const buyerRelease = buyerBlocked;

        if (sellerRelease > 0) {
          await this.walletService.releaseEscrow(
            order.sellerId,
            sellerRelease,
            order.listingId,
            tx,
            { orderId: order.id },
          );
        }
        if (buyerRelease > 0) {
          await this.walletService.releaseEscrow(
            order.buyerId,
            buyerRelease,
            order.listingId,
            tx,
            { orderId: order.id },
          );
        }

        const prevExchangeStatus = order.status;
        const completedExchange = await tx.order.update({
          where: { id: orderId },
          data: { status: OrderStatus.COMPLETED },
        });
        await this.orderReputation.recordTerminalOutcome(
          tx,
          {
            id: order.id,
            buyerId: order.buyerId,
            sellerId: order.sellerId,
            tradeReputationAt: order.tradeReputationAt,
          },
          prevExchangeStatus,
          'SUCCESS',
        );
        return completedExchange;
      }

      if (order.buyerId !== userId)
        throw new BadRequestException('شما خریدار این سفارش نیستید');

      // اجازه نمیدیم سفارشی که قبلا تکمیل شده دوباره تایید بشه
      if (order.status === OrderStatus.COMPLETED)
        throw new BadRequestException('این سفارش قبلاً تسویه شده است');
      this.stateMachine.assertTransition(
        order.status,
        OrderStatus.COMPLETED,
        'confirm-order',
      );

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
        data: { trustScore: { increment: 2 } },
      });

      // 🎯 تغییر وضعیت به تکمیل شده (تسویه نهایی)
      const prevDirectStatus = order.status;
      const completedDirect = await tx.order.update({
        where: { id: orderId },
        data: { status: OrderStatus.COMPLETED },
      });
      await this.orderReputation.recordTerminalOutcome(
        tx,
        {
          id: order.id,
          buyerId: order.buyerId,
          sellerId: order.sellerId,
          tradeReputationAt: order.tradeReputationAt,
        },
        prevDirectStatus,
        'SUCCESS',
      );
      return completedDirect;
    });
  }
  // =================================================================
  // 6. دریافت جزئیات سفارش
  // =================================================================
  async getOrderById(userId: string, orderId: string) {
    let order = await this.prisma.order.findUnique({
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
        buyer: {
          select: {
            id: true,
            firstName: true,
            lastName: true,
            avatar: true,
            phone: true,
          },
        },
        seller: {
          select: {
            id: true,
            firstName: true,
            lastName: true,
            avatar: true,
            phone: true,
          },
        },
      },
    });

    if (!order) throw new NotFoundException('سفارش یافت نشد');
    if (order.buyerId !== userId && order.sellerId !== userId) {
      throw new ForbiddenException('عدم دسترسی');
    }

    order = await this.attachBuyerConfirmDeadline(order);

    const autoConfirmed = await this.tryAutoConfirmExpiredOrder(orderId);
    if (autoConfirmed) {
      const refreshedAfterConfirm = await this.prisma.order.findUnique({
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
          buyer: {
            select: {
              id: true,
              firstName: true,
              lastName: true,
              avatar: true,
              phone: true,
            },
          },
          seller: {
            select: {
              id: true,
              firstName: true,
              lastName: true,
              avatar: true,
              phone: true,
            },
          },
        },
      });
      if (refreshedAfterConfirm) {
        order = await this.attachBuyerConfirmDeadline(refreshedAfterConfirm);
      }
    }

    const shippingCancelled =
      await this.tryCancelExpiredShippingForOrder(orderId);
    if (shippingCancelled) {
      const refreshed = await this.prisma.order.findUnique({
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
          buyer: {
            select: {
              id: true,
              firstName: true,
              lastName: true,
              avatar: true,
              phone: true,
            },
          },
          seller: {
            select: {
              id: true,
              firstName: true,
              lastName: true,
              avatar: true,
              phone: true,
            },
          },
        },
      });
      if (refreshed) order = await this.attachBuyerConfirmDeadline(refreshed);
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
      (order as any).exchangePaymentSources = exchangePaymentSources;
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
      const noteCandidates = await this.prisma.notification.findMany({
        where: {
          userId,
          type: NotificationType.ORDER_STATUS_CHANGED,
          meta: {
            path: ['orderId'],
            equals: orderId,
          },
        },
        orderBy: { createdAt: 'desc' },
        take: 10,
        select: { meta: true, createdAt: true },
      });

      const hubShipmentNotification =
        noteCandidates.find((n) => {
          const note = (n.meta as Record<string, unknown> | null)?.['note'];
          return typeof note === 'string' && note.trim().length > 0;
        }) ?? null;

      const hubShipmentNoteRaw = (
        hubShipmentNotification?.meta as Record<string, unknown> | null
      )?.['note'];
      hubShipmentNote =
        typeof hubShipmentNoteRaw === 'string' &&
        hubShipmentNoteRaw.trim().length > 0
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
      order.status === 'SHIPPED' ||
      order.status === OrderStatus.SHIPPED_TO_BUYER ||
      order.status === 'DELIVERED' ||
      order.status === 'COMPLETED' ||
      order.status === 'DISPUTED' ||
      order.status === OrderStatus.RETURN_REQUESTED ||
      order.status === OrderStatus.RETURN_SHIPPED;

    const stripPhone = (u: { phone?: string | null } | null) =>
      u ? { ...u, phone: contactReleased ? u.phone : null } : u;

    if (order.buyer)
      order.buyer = stripPhone(order.buyer) as typeof order.buyer;
    if (order.seller)
      order.seller = stripPhone(order.seller) as typeof order.seller;

    // حالت هاب (کالا قبل از ارسال به خریدار باید به طبقه ارسال بشه).
    // در این حالت آدرس واقعی خریدار به فروشنده نمایش داده نمیشه و کلاً
    // اطلاعات طرف مقابل ماسک می‌مونه.
    if (needsHub && isSellerView) {
      const hubAddress =
        order.platformAddress || 'تهران، دفتر مرکزی پردازش و کارشناسی طبقه';
      const maskedOrder: any = {
        ...order,
        buyer: order.buyer
          ? {
              id: order.buyer.id,
              firstName: 'خریدار',
              lastName: '',
              avatar: null,
              phone: null,
            }
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
      return this.attachBuyerConfirmDeadline(maskedOrder);
    }

    // اقتصاد داخلی پلتفرم نباید به خریدار لو بره.
    if (isBuyerView) {
      const cloned: any = { ...order };
      cloned.platformFee = undefined;
      cloned.sellerRevenue = undefined;
      cloned.sellerShippingCost = undefined;
      return this.attachBuyerConfirmDeadline(cloned);
    }

    return this.attachBuyerConfirmDeadline(order);
  } // =================================================================
  // 7. ثبت شکایت (Dispute) ✅ اصلاح شده برای حل ارور includes
  // =================================================================
  async disputeOrder(
    buyerId: string,
    orderId: string,
    reason: string,
    videoPath?: string,
  ) {
    return this.prisma.$transaction(async (tx) => {
      const order = await tx.order.findUnique({
        where: { id: orderId },
        include: { listing: true },
      });

      if (!order) throw new NotFoundException('سفارش یافت نشد');
      if (order.buyerId !== buyerId)
        throw new BadRequestException('شما خریدار نیستید');
      if (order.type === OrderType.EXCHANGE) {
        throw new BadRequestException(
          'برای معاملات معاوضه امکان ثبت شکایت در این مرحله وجود ندارد',
        );
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
        Boolean(
          order.requiresVerification ||
          order.listing?.sellerRequiresVerification,
        ) &&
        [
          OrderStatus.SHIPPED_TO_BUYER,
          OrderStatus.SHIPPED,
          OrderStatus.DELIVERED,
        ].includes(order.status);
      if (wasInspectedAndApproved) {
        throw new BadRequestException(
          'برای سفارش کارشناسی‌شده و ارسال‌شده، امکان ثبت شکایت وجود ندارد',
        );
      }

      this.stateMachine.assertTransition(
        order.status,
        OrderStatus.DISPUTED,
        'dispute-order',
      );
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
      const videoLink = videoPath
        ? `\n🎥 ویدیو: ${apiUrl}/uploads/orders/${videoPath}`
        : '';

      const ticketMessage = `🚨 **اعلام مغایرت سفارش**\nکالا: ${order.listing.title}\nعلت: ${reason}\n${videoLink}`;

      const createdTicket = await tx.ticket.create({
        data: {
          userId: buyerId,
          subject: `شکایت سفارش #${order.id.slice(-6)}`,
          status: 'OPEN',
          messages: {
            create: { senderRole: 'USER', message: ticketMessage },
          },
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

      await this.listingCommand.rejectAfterTradeFailure(tx, {
        listingId: order.listingId,
        sellerId: order.sellerId,
        listingTitle: order.listing?.title ?? 'کالا',
        rejectionReason: `شکایت خریدار: ${reason.trim()}`,
        source: 'dispute',
        orderId: order.id,
      });

      return {
        success: true,
        message: 'شکایت شما ثبت شد و مبلغ مسدود ماند.',
        ticketId: createdTicket.id,
      };
    });
  }

  /**
   * پس از لغو معامله به‌دلیل عدم ارسال در مهلت، آگهی نباید خودکار منتشر بماند.
   * وضعیت REJECTED می‌شود تا فروشنده در صورت تمایل دوباره ویرایش و ثبت کند.
   */
  private async rejectListingAfterShippingTimeoutCancel(
    tx: Prisma.TransactionClient,
    params: {
      listingId: string;
      sellerId: string;
      listingTitle: string;
      rejectionReason: string;
      orderId?: string;
    },
  ): Promise<void> {
    await this.listingCommand.rejectAfterTradeFailure(tx, {
      listingId: params.listingId,
      sellerId: params.sellerId,
      listingTitle: params.listingTitle,
      rejectionReason: params.rejectionReason,
      source: 'shipping-timeout',
      orderId: params.orderId,
    });
  }

  /** تیکت و اعلان برای لغو فروش مستقیم به‌دلیل عدم ارسال فروشنده در مهلت */
  private async createShippingTimeoutCancelTickets(
    tx: Prisma.TransactionClient,
    params: {
      orderId: string;
      buyerId: string;
      sellerId: string;
      listingTitle: string;
      totalAmount: number;
      trustPenaltyPoints?: number;
    },
  ): Promise<void> {
    const shortId = params.orderId.slice(-6);
    const amountFa = Math.max(
      0,
      Number(params.totalAmount) || 0,
    ).toLocaleString('fa-IR');
    const penalty = params.trustPenaltyPoints ?? 15;
    const listingTitle = params.listingTitle?.trim() || 'کالا';

    const buyerTicketMessage = [
      'سلام،',
      '',
      `متأسفیم؛ سفارش #${shortId} برای «${listingTitle}» لغو شد.`,
      'دلیل: فروشنده در مهلت قانونی ارسال، مرسوله را ثبت نکرد.',
      '',
      `مبلغ پرداختی شما (${amountFa} تومان) به کیف پولتان در طبقه برگشت داده شد.`,
      'از صبر و شکیبایی شما سپاسگزاریم و بابت ناراحتی پیش‌آمده پوزش می‌خواهیم.',
      '',
      `طبق قوانین طبقه، ${penalty} واحد از امتیاز اعتماد فروشنده کسر شد.`,
      '',
      'در صورت نیاز می‌توانید از همین تیکت با پشتیبانی در ارتباط باشید.',
    ].join('\n');

    const sellerTicketMessage = [
      'سلام،',
      '',
      `سفارش #${shortId} برای «${listingTitle}» لغو شد.`,
      'دلیل: شما در مهلت قانونی ارسال، کد رهگیری یا ویدیوی بسته‌بندی را ثبت نکردید.',
      '',
      `وجه پرداختی خریدار (${amountFa} تومان) به کیف پول او برگشت داده شد.`,
      'مبلغ بلوکه‌شده در کیف پول شما نیز آزاد شد.',
      '',
      `به‌دلیل تأخیر در ارسال، ${penalty} واحد از امتیاز اعتماد شما کسر شد.`,
      '',
      'برای سفارش‌های بعدی لطفاً ارسال را در مهلت مقرر انجام دهید.',
    ].join('\n');

    const buyerTicket = await tx.ticket.create({
      data: {
        userId: params.buyerId,
        subject: `لغو سفارش — عدم ارسال فروشنده [ORDER:${params.orderId}]`,
        status: 'OPEN',
        messages: {
          create: {
            senderRole: UserRole.ADMIN,
            message: buyerTicketMessage,
          },
        },
      },
      select: { id: true },
    });

    const sellerTicket = await tx.ticket.create({
      data: {
        userId: params.sellerId,
        subject: `لغو سفارش — عدم ارسال در مهلت [ORDER:${params.orderId}]`,
        status: 'OPEN',
        messages: {
          create: {
            senderRole: UserRole.ADMIN,
            message: sellerTicketMessage,
          },
        },
      },
      select: { id: true },
    });

    await tx.notification.createMany({
      data: [
        {
          userId: params.buyerId,
          type: NotificationType.TICKET_REPLY,
          title: 'سفارش لغو شد — بازگشت وجه',
          message: `سفارش #${shortId} به‌دلیل عدم ارسال فروشنده لغو شد و مبلغ به کیف پول شما برگشت.`,
          meta: {
            orderId: params.orderId,
            ticketId: buyerTicket.id,
            reason: 'shipping-timeout-cancel',
          } as Prisma.InputJsonValue,
        },
        {
          userId: params.sellerId,
          type: NotificationType.TICKET_REPLY,
          title: 'سفارش لغو شد — کسر امتیاز',
          message: `سفارش #${shortId} به‌دلیل عدم ارسال در مهلت لغو شد؛ وجه به خریدار برگشت و امتیاز شما کاهش یافت.`,
          meta: {
            orderId: params.orderId,
            ticketId: sellerTicket.id,
            reason: 'shipping-timeout-cancel',
          } as Prisma.InputJsonValue,
        },
      ],
    });
  }

  /**
   * تیکت و اعلان برای لغو معاوضه به‌دلیل اتمام مهلت پرداخت.
   * scenario: neither | buyer_paid_only | seller_paid_only | both_incomplete
   */
  private async createExchangePaymentTimeoutCancelTickets(
    tx: Prisma.TransactionClient,
    params: {
      orderId: string | null;
      buyerId: string;
      sellerId: string;
      listingTitle: string;
      scenario:
        | 'neither_paid'
        | 'buyer_paid_only'
        | 'seller_paid_only'
        | 'both_incomplete';
      buyerRefundAmount: number;
      sellerRefundAmount: number;
      offenderIds: string[];
    },
  ): Promise<void> {
    const shortId = params.orderId ? params.orderId.slice(-6) : '------';
    const penalty = OrdersService.EXCHANGE_PAYMENT_TIMEOUT_TRUST_PENALTY;
    const listingTitle = params.listingTitle?.trim() || 'کالا';
    const buyerAmountFa = Math.max(
      0,
      Number(params.buyerRefundAmount) || 0,
    ).toLocaleString('fa-IR');
    const sellerAmountFa = Math.max(
      0,
      Number(params.sellerRefundAmount) || 0,
    ).toLocaleString('fa-IR');

    const buildCompliantPartyMessage = (
      role: 'buyer' | 'seller',
      refundAmountFa: string,
    ) => {
      const lines = [
        'سلام،',
        '',
        `متأسفیم؛ معامله معاوضه${params.orderId ? ` #${shortId}` : ''} برای «${listingTitle}» لغو شد.`,
      ];
      if (params.scenario === 'neither_paid') {
        lines.push(
          'دلیل: هیچ‌یک از طرفین در مهلت مقرر پرداخت خود را تکمیل نکردند.',
        );
      } else if (params.scenario === 'both_incomplete') {
        lines.push(
          'دلیل: مهلت پرداخت به پایان رسید و معامله به‌طور کامل تسویه نشد.',
        );
      } else {
        lines.push(
          'دلیل: طرف مقابل در مهلت مقرر پرداخت خود را تکمیل نکرد.',
          'شما تعهد خود را انجام داده‌اید؛ از بابت این تجربه ناخوشایند صمیمانه پوزش می‌خواهیم.',
        );
      }
      if (Number(params.buyerRefundAmount) > 0 && role === 'buyer') {
        lines.push(
          '',
          `سهم پرداختی شما (${refundAmountFa} تومان) به کیف پولتان برگشت داده شد.`,
        );
      }
      if (Number(params.sellerRefundAmount) > 0 && role === 'seller') {
        lines.push(
          '',
          `سهم پرداختی شما (${refundAmountFa} تومان) به کیف پولتان برگشت داده شد.`,
        );
      }
      if (
        params.offenderIds.includes(
          role === 'buyer' ? params.buyerId : params.sellerId,
        )
      ) {
        lines.push(
          '',
          `طبق قوانین طبقه، ${penalty} واحد از امتیاز اعتماد شما کسر شد.`,
        );
      }
      lines.push(
        '',
        'در صورت نیاز می‌توانید از همین تیکت با پشتیبانی در ارتباط باشید.',
      );
      return lines.join('\n');
    };

    const buildOffenderMessage = (role: 'buyer' | 'seller') => {
      const isBuyer = role === 'buyer';
      const userId = isBuyer ? params.buyerId : params.sellerId;
      if (!params.offenderIds.includes(userId)) {
        return buildCompliantPartyMessage(
          role,
          isBuyer ? buyerAmountFa : sellerAmountFa,
        );
      }
      return [
        'سلام،',
        '',
        `معامله معاوضه${params.orderId ? ` #${shortId}` : ''} برای «${listingTitle}» لغو شد.`,
        'دلیل: شما در مهلت مقرر پرداخت سهم خود را تکمیل نکردید.',
        '',
        `طبق قوانین طبقه، ${penalty} واحد از امتیاز اعتماد شما کسر شد.`,
        isBuyer
          ? 'آگهی برای پذیرش پیشنهادهای دیگر در دسترس باقی می‌ماند.'
          : 'آگهی شما به‌دلیل عدم پرداخت در مهلت مقرر از انتشار خارج شد؛ برای فروش مجدد آن را ویرایش و دوباره ثبت کنید.',
        '',
        'در صورت نیاز می‌توانید از همین تیکت با پشتیبانی در ارتباط باشید.',
      ].join('\n');
    };

    const buyerTicket = await tx.ticket.create({
      data: {
        userId: params.buyerId,
        subject: `لغو معاوضه — مهلت پرداخت [${params.orderId ? `ORDER:${params.orderId}` : `LISTING:${listingTitle}`}]`,
        status: 'OPEN',
        messages: {
          create: {
            senderRole: UserRole.ADMIN,
            message: buildOffenderMessage('buyer'),
          },
        },
      },
      select: { id: true },
    });

    const sellerTicket = await tx.ticket.create({
      data: {
        userId: params.sellerId,
        subject: `لغو معاوضه — مهلت پرداخت [${params.orderId ? `ORDER:${params.orderId}` : `LISTING:${listingTitle}`}]`,
        status: 'OPEN',
        messages: {
          create: {
            senderRole: UserRole.ADMIN,
            message: buildOffenderMessage('seller'),
          },
        },
      },
      select: { id: true },
    });

    const buyerCompliant = !params.offenderIds.includes(params.buyerId);
    const sellerCompliant = !params.offenderIds.includes(params.sellerId);

    await tx.notification.createMany({
      data: [
        {
          userId: params.buyerId,
          type: NotificationType.TICKET_REPLY,
          title: buyerCompliant
            ? 'معاوضه لغو شد — بازگشت وجه'
            : 'معاوضه لغو شد — مهلت پرداخت',
          message: buyerCompliant
            ? `معاوضه برای «${listingTitle}» لغو شد. سهم پرداختی شما به کیف پول برگشت؛ بابت ناراحتی پیش‌آمده پوزش می‌خواهیم.`
            : `معاوضه برای «${listingTitle}» به‌دلیل عدم تکمیل پرداخت شما در مهلت مقرر لغو شد.`,
          meta: {
            ...(params.orderId ? { orderId: params.orderId } : {}),
            ticketId: buyerTicket.id,
            reason: 'exchange-payment-timeout-cancel',
          } as Prisma.InputJsonValue,
        },
        {
          userId: params.sellerId,
          type: NotificationType.TICKET_REPLY,
          title: sellerCompliant
            ? 'معاوضه لغو شد — بازگشت وجه'
            : 'معاوضه لغو شد — مهلت پرداخت',
          message: sellerCompliant
            ? `معاوضه برای «${listingTitle}» لغو شد. سهم پرداختی شما به کیف پول برگشت؛ بابت ناراحتی پیش‌آمده پوزش می‌خواهیم.`
            : `معاوضه برای «${listingTitle}» به‌دلیل عدم تکمیل پرداخت شما در مهلت مقرر لغو شد.`,
          meta: {
            ...(params.orderId ? { orderId: params.orderId } : {}),
            ticketId: sellerTicket.id,
            reason: 'exchange-payment-timeout-cancel',
          } as Prisma.InputJsonValue,
        },
      ],
    });
  }

  /** تیکت و اعلان برای لغو معاوضه به‌دلیل عدم ارسال هر دو طرف در مهلت */
  private async createExchangeBothNoShipmentCancelTickets(
    tx: Prisma.TransactionClient,
    params: {
      orderId: string;
      buyerId: string;
      sellerId: string;
      listingTitle: string;
      buyerRefundAmount: number;
      sellerRefundAmount: number;
      trustPenaltyPoints?: number;
    },
  ): Promise<void> {
    const shortId = params.orderId.slice(-6);
    const penalty = params.trustPenaltyPoints ?? 15;
    const listingTitle = params.listingTitle?.trim() || 'کالا';
    const buyerAmountFa = Math.max(
      0,
      Number(params.buyerRefundAmount) || 0,
    ).toLocaleString('fa-IR');
    const sellerAmountFa = Math.max(
      0,
      Number(params.sellerRefundAmount) || 0,
    ).toLocaleString('fa-IR');

    const buyerTicketMessage = [
      'سلام،',
      '',
      `متأسفیم؛ معامله معاوضه #${shortId} برای «${listingTitle}» لغو شد.`,
      'دلیل: هیچ‌یک از طرفین در مهلت قانونی ارسال، مرسوله را ثبت نکردند.',
      '',
      `سهم پرداختی شما (${buyerAmountFa} تومان، شامل هزینه کارشناسی) به کیف پولتان برگشت داده شد.`,
      'از صبر و شکیبایی شما سپاسگزاریم و بابت ناراحتی پیش‌آمده پوزش می‌خواهیم.',
      '',
      `طبق قوانین طبقه، ${penalty} واحد از امتیاز اعتماد شما کسر شد.`,
      '',
      'در صورت نیاز می‌توانید از همین تیکت با پشتیبانی در ارتباط باشید.',
    ].join('\n');

    const sellerTicketMessage = [
      'سلام،',
      '',
      `متأسفیم؛ معامله معاوضه #${shortId} برای «${listingTitle}» لغو شد.`,
      'دلیل: هیچ‌یک از طرفین در مهلت قانونی ارسال، مرسوله را ثبت نکردند.',
      '',
      `سهم پرداختی شما (${sellerAmountFa} تومان، شامل هزینه کارشناسی) به کیف پولتان برگشت داده شد.`,
      'از صبر و شکیبایی شما سپاسگزاریم و بابت ناراحتی پیش‌آمده پوزش می‌خواهیم.',
      '',
      `طبق قوانین طبقه، ${penalty} واحد از امتیاز اعتماد شما کسر شد.`,
      '',
      'در صورت نیاز می‌توانید از همین تیکت با پشتیبانی در ارتباط باشید.',
    ].join('\n');

    const buyerTicket = await tx.ticket.create({
      data: {
        userId: params.buyerId,
        subject: `لغو معاوضه — عدم ارسال هر دو طرف [ORDER:${params.orderId}]`,
        status: 'OPEN',
        messages: {
          create: {
            senderRole: UserRole.ADMIN,
            message: buyerTicketMessage,
          },
        },
      },
      select: { id: true },
    });

    const sellerTicket = await tx.ticket.create({
      data: {
        userId: params.sellerId,
        subject: `لغو معاوضه — عدم ارسال هر دو طرف [ORDER:${params.orderId}]`,
        status: 'OPEN',
        messages: {
          create: {
            senderRole: UserRole.ADMIN,
            message: sellerTicketMessage,
          },
        },
      },
      select: { id: true },
    });

    await tx.notification.createMany({
      data: [
        {
          userId: params.buyerId,
          type: NotificationType.TICKET_REPLY,
          title: 'معاوضه لغو شد — بازگشت وجه',
          message: `معاوضه #${shortId} به‌دلیل عدم ارسال هر دو طرف لغو شد و سهم پرداختی شما به کیف پول برگشت.`,
          meta: {
            orderId: params.orderId,
            ticketId: buyerTicket.id,
            reason: 'exchange-both-no-shipment-cancel',
          } as Prisma.InputJsonValue,
        },
        {
          userId: params.sellerId,
          type: NotificationType.TICKET_REPLY,
          title: 'معاوضه لغو شد — بازگشت وجه',
          message: `معاوضه #${shortId} به‌دلیل عدم ارسال هر دو طرف لغو شد و سهم پرداختی شما به کیف پول برگشت.`,
          meta: {
            orderId: params.orderId,
            ticketId: sellerTicket.id,
            reason: 'exchange-both-no-shipment-cancel',
          } as Prisma.InputJsonValue,
        },
      ],
    });
  }

  /** تیکت و اعلان: یک طرف ارسال کرده، طرف مقابل در مهلت ارسال نکرده */
  private async createExchangeOneSideNoShipmentCancelTickets(
    tx: Prisma.TransactionClient,
    params: {
      orderId: string;
      buyerId: string;
      sellerId: string;
      senderId: string;
      offenderId: string;
      listingTitle: string;
      senderRefundAmount: number;
      offenderRefundAmount: number;
      compensationAmount: number;
      inspectionPenaltyPercent: number;
      trustPenaltyPoints?: number;
    },
  ): Promise<void> {
    const shortId = params.orderId.slice(-6);
    const penalty = params.trustPenaltyPoints ?? 15;
    const listingTitle = params.listingTitle?.trim() || 'کالا';
    const senderAmountFa = Math.max(
      0,
      Number(params.senderRefundAmount) || 0,
    ).toLocaleString('fa-IR');
    const offenderAmountFa = Math.max(
      0,
      Number(params.offenderRefundAmount) || 0,
    ).toLocaleString('fa-IR');
    const compensationFa = Math.max(
      0,
      Number(params.compensationAmount) || 0,
    ).toLocaleString('fa-IR');
    const penaltyPct = params.inspectionPenaltyPercent;

    const senderMessage = [
      'سلام،',
      '',
      `متأسفیم؛ معامله معاوضه #${shortId} برای «${listingTitle}» لغو شد.`,
      'دلیل: شما به‌موقع ارسال را ثبت کردید اما طرف مقابل در مهلت قانونی ارسال نکرد.',
      '',
      `سهم پرداختی شما (${senderAmountFa} تومان) به کیف پولتان برگشت.`,
      compensationFa !== '۰'
        ? `همچنین ${compensationFa} تومان بابت ${penaltyPct}٪ جبران از هزینه کارشناسی طرف مقابل به کیف پول شما واریز شد.`
        : '',
      'کالای شما بدون کارشناسی در صف مرجوع از هاب قرار می‌گیرد تا به آدرس شما برگردد.',
      '',
      'از صبر و شکیبایی شما سپاسگزاریم و بابت ناراحتی پیش‌آمده صمیمانه پوزش می‌خواهیم.',
      '',
      'در صورت نیاز می‌توانید از همین تیکت با پشتیبانی در ارتباط باشید.',
    ]
      .filter(Boolean)
      .join('\n');

    const offenderMessage = [
      'سلام،',
      '',
      `معامله معاوضه #${shortId} برای «${listingTitle}» لغو شد.`,
      'دلیل: شما در مهلت قانونی ارسال، کد رهگیری یا ویدیوی بسته‌بندی را ثبت نکردید.',
      '',
      offenderAmountFa !== '۰'
        ? `پس از کسر ${penaltyPct}٪ جریمه از هزینه کارشناسی، ${offenderAmountFa} تومان به کیف پول شما برگشت.`
        : `طبق قوانین، ${penaltyPct}٪ از هزینه کارشناسی شما به‌عنوان جریمه کسر شد.`,
      '',
      `به‌دلیل تأخیر در ارسال، ${penalty} واحد از امتیاز اعتماد شما کسر شد.`,
      '',
      'در صورت نیاز می‌توانید از همین تیکت با پشتیبانی در ارتباط باشید.',
    ].join('\n');

    const buyerIsSender = params.senderId === params.buyerId;
    const buyerTicket = await tx.ticket.create({
      data: {
        userId: params.buyerId,
        subject: `لغو معاوضه — عدم ارسال طرف مقابل [ORDER:${params.orderId}]`,
        status: 'OPEN',
        messages: {
          create: {
            senderRole: UserRole.ADMIN,
            message: buyerIsSender ? senderMessage : offenderMessage,
          },
        },
      },
      select: { id: true },
    });

    const sellerTicket = await tx.ticket.create({
      data: {
        userId: params.sellerId,
        subject: `لغو معاوضه — عدم ارسال طرف مقابل [ORDER:${params.orderId}]`,
        status: 'OPEN',
        messages: {
          create: {
            senderRole: UserRole.ADMIN,
            message: buyerIsSender ? offenderMessage : senderMessage,
          },
        },
      },
      select: { id: true },
    });

    await tx.notification.createMany({
      data: [
        {
          userId: params.buyerId,
          type: NotificationType.TICKET_REPLY,
          title: buyerIsSender
            ? 'معاوضه لغو شد — بازگشت وجه و مرجوع کالا'
            : 'معاوضه لغو شد — کسر امتیاز',
          message: buyerIsSender
            ? `معامله «${listingTitle}» لغو شد؛ وجه شما برگشت و کالا بدون کارشناسی در صف مرجوع از هاب است.`
            : `معامله «${listingTitle}» به‌دلیل عدم ارسال شما در مهلت لغو شد.`,
          meta: {
            orderId: params.orderId,
            ticketId: buyerTicket.id,
            reason: 'exchange-one-side-no-shipment-cancel',
          } as Prisma.InputJsonValue,
        },
        {
          userId: params.sellerId,
          type: NotificationType.TICKET_REPLY,
          title: buyerIsSender
            ? 'معاوضه لغو شد — کسر امتیاز'
            : 'معاوضه لغو شد — بازگشت وجه و مرجوع کالا',
          message: buyerIsSender
            ? `معامله «${listingTitle}» به‌دلیل عدم ارسال شما در مهلت لغو شد.`
            : `معامله «${listingTitle}» لغو شد؛ وجه شما برگشت و کالا بدون کارشناسی در صف مرجوع از هاب است.`,
          meta: {
            orderId: params.orderId,
            ticketId: sellerTicket.id,
            reason: 'exchange-one-side-no-shipment-cancel',
          } as Prisma.InputJsonValue,
        },
      ],
    });
  }

  // =================================================================
  // 8. جاب‌های خودکار
  // =================================================================

  private static readonly BUYER_CONFIRM_ELIGIBLE_STATUSES: OrderStatus[] = [
    OrderStatus.SHIPPED,
    OrderStatus.SHIPPED_TO_BUYER,
    OrderStatus.DELIVERED,
  ];

  private static readonly AWAITING_SELLER_SHIPMENT_STATUSES: OrderStatus[] = [
    OrderStatus.PAID,
    OrderStatus.AWAITING_SHIPMENT_TO_HUB,
  ];

  private async getSellerShipDeadlineMinutes(): Promise<number> {
    const setting = await this.prisma.systemSetting.findFirst({
      where: {
        key: {
          in: ['SELLER_SHIP_DEADLINE_MINUTES', 'SELLER_SHIP_DEADLINE_DAYS'],
        },
      },
      orderBy: { key: 'asc' },
    });
    let minutes = this.parsePositiveIntSetting(
      setting?.value,
      OrdersService.DEFAULT_SELLER_SHIP_DEADLINE_MINUTES,
    );
    if (setting?.key === 'SELLER_SHIP_DEADLINE_DAYS') {
      minutes *= 24 * 60;
    }
    return minutes;
  }

  private async resolveEffectiveShippingDeadline(order: {
    shippingDeadline: Date | null;
    updatedAt: Date;
    createdAt: Date;
  }): Promise<Date | null> {
    if (order.shippingDeadline) return order.shippingDeadline;
    const minutes = await this.getSellerShipDeadlineMinutes();
    const base = order.updatedAt ?? order.createdAt;
    if (!base) return null;
    return new Date(base.getTime() + minutes * 60 * 1000);
  }

  /** برای ثبت مهلت هنگام ارسال از هاب / ارسال مستقیم */
  computeBuyerConfirmDeadlineNow(): Promise<Date> {
    return this.buildBuyerConfirmDeadlineFrom(new Date());
  }

  private async buildBuyerConfirmDeadlineFrom(from: Date): Promise<Date> {
    const minutes = await this.getBuyerConfirmDeadlineMinutes();
    return new Date(from.getTime() + minutes * 60 * 1000);
  }

  /** پس از ensure در DB، مقدار را روی آبجکت سفارش برای پاسخ API می‌نشاند */
  private async attachBuyerConfirmDeadline<
    T extends {
      id: string;
      status: OrderStatus;
      buyerConfirmDeadline?: Date | null;
      updatedAt: Date;
      createdAt: Date;
      disputedAt?: Date | null;
    },
  >(order: T): Promise<T> {
    if (!OrdersService.BUYER_CONFIRM_ELIGIBLE_STATUSES.includes(order.status)) {
      return this.enrichOrderClientFields(order);
    }
    await this.ensureBuyerConfirmDeadline(order.id);
    const fresh = await this.prisma.order.findUnique({
      where: { id: order.id },
      select: { buyerConfirmDeadline: true },
    });
    const deadline =
      fresh?.buyerConfirmDeadline ??
      (await this.resolveEffectiveBuyerConfirmDeadline({
        status: order.status,
        buyerConfirmDeadline: fresh?.buyerConfirmDeadline ?? null,
        updatedAt: order.updatedAt,
        createdAt: order.createdAt,
      }));
    if (!deadline) return this.enrichOrderClientFields(order);
    return this.enrichOrderClientFields({
      ...order,
      buyerConfirmDeadline: deadline,
    });
  }

  private parseReturnDestinationFromCancelReason(cancelReason: string | null): {
    address: string | null;
    postalCode: string | null;
  } {
    const raw = String(cancelReason || '');
    if (!raw.trim()) {
      return { address: null, postalCode: null };
    }
    const lines = raw.split('\n').map((x) => x.trim());
    const pick = (labels: string[]) => {
      for (const label of labels) {
        const line = lines.find((x) => x.startsWith(`${label}:`));
        if (!line) continue;
        const val = line.slice(label.length + 1).trim();
        if (val) return val;
      }
      return null;
    };
    return {
      address: pick(['آدرس مقصد', 'نشانی مقصد', 'آدرس مرجوعی']),
      postalCode: pick(['کدپستی مقصد', 'کد پستی مقصد', 'کدپستی مرجوعی']),
    };
  }

  private enrichOrderClientFields<T extends Record<string, unknown>>(
    order: T,
  ): T {
    const o = order as T & {
      cancelReason?: string | null;
      status?: OrderStatus;
      sellerShippingAddress?: string | null;
      sellerShippingPostalCode?: string | null;
      buyerConfirmDeadline?: Date | string | null;
    };
    const parsed = this.parseReturnDestinationFromCancelReason(
      o.cancelReason ?? null,
    );
    let returnDestinationAddress = parsed.address;
    let returnDestinationPostalCode = parsed.postalCode;
    if (
      (!returnDestinationAddress || returnDestinationAddress.length < 5) &&
      o.status &&
      (o.status === OrderStatus.RETURN_REQUESTED ||
        o.status === OrderStatus.RETURN_SHIPPED)
    ) {
      returnDestinationAddress =
        o.sellerShippingAddress?.trim() || returnDestinationAddress;
      returnDestinationPostalCode =
        o.sellerShippingPostalCode?.trim() || returnDestinationPostalCode;
    }
    const deadlineRaw = o.buyerConfirmDeadline;
    const buyerConfirmDeadline =
      deadlineRaw instanceof Date
        ? deadlineRaw.toISOString()
        : typeof deadlineRaw === 'string'
          ? deadlineRaw
          : null;
    return {
      ...order,
      buyerConfirmDeadline,
      returnDestinationAddress: returnDestinationAddress ?? null,
      returnDestinationPostalCode: returnDestinationPostalCode ?? null,
    } as T;
  }

  private async resolveEffectiveBuyerConfirmDeadline(order: {
    status: OrderStatus;
    buyerConfirmDeadline: Date | null;
    updatedAt: Date;
    createdAt: Date;
  }): Promise<Date | null> {
    if (!OrdersService.BUYER_CONFIRM_ELIGIBLE_STATUSES.includes(order.status)) {
      return null;
    }
    if (order.buyerConfirmDeadline) return order.buyerConfirmDeadline;
    const minutes = await this.getBuyerConfirmDeadlineMinutes();
    const base = order.updatedAt ?? order.createdAt;
    if (!base) return null;
    return new Date(base.getTime() + minutes * 60 * 1000);
  }

  private async isBuyerConfirmDeadlineExpired(order: {
    status: OrderStatus;
    buyerConfirmDeadline: Date | null;
    disputedAt: Date | null;
    updatedAt: Date;
    createdAt: Date;
  }): Promise<boolean> {
    if (order.disputedAt) return false;
    if (!OrdersService.BUYER_CONFIRM_ELIGIBLE_STATUSES.includes(order.status)) {
      return false;
    }
    const deadline = await this.resolveEffectiveBuyerConfirmDeadline(order);
    if (!deadline) return false;
    return deadline.getTime() <= Date.now();
  }

  /** ثبت مهلت تایید دریافت هنگام ورود به وضعیت «ارسال‌شده» (یک‌بار) */
  async ensureBuyerConfirmDeadline(orderId: string): Promise<void> {
    const order = await this.prisma.order.findUnique({
      where: { id: orderId },
      select: {
        id: true,
        status: true,
        buyerConfirmDeadline: true,
        updatedAt: true,
        createdAt: true,
      },
    });
    if (!order) return;
    if (order.buyerConfirmDeadline) return;
    if (!OrdersService.BUYER_CONFIRM_ELIGIBLE_STATUSES.includes(order.status)) {
      return;
    }
    const minutes = await this.getBuyerConfirmDeadlineMinutes();
    const base = order.updatedAt ?? order.createdAt ?? new Date();
    const ageMs = Date.now() - base.getTime();
    // اگر سفارش قدیمی است ولی مهلت در DB ثبت نشده، از «الان» شمارش شود تا UI و کرون منطقی بمانند
    const deadlineBase = ageMs > minutes * 60 * 1000 ? new Date() : base;
    const deadline = await this.buildBuyerConfirmDeadlineFrom(deadlineBase);
    await this.prisma.order.update({
      where: { id: orderId },
      data: { buyerConfirmDeadline: deadline },
    });
  }

  /**
   * تایید خودکار یک سفارش منقضی‌شده (مشابه کرون؛ هنگام باز کردن صفحه سفارش).
   */
  async tryAutoConfirmExpiredOrder(orderId: string): Promise<boolean> {
    const order = await this.prisma.order.findUnique({
      where: { id: orderId },
    });
    if (!order) return false;
    if (!(await this.isBuyerConfirmDeadlineExpired(order))) return false;
    await this.processAutoConfirmOrder(order);
    return true;
  }

  /** آیا مهلت ارسال گذشته و سفارش باید لغو/تسویه شود؟ */
  async isShippingDeadlineExpired(order: {
    status: OrderStatus;
    type: OrderType;
    shippingDeadline: Date | null;
    trackingCode: string | null;
    sellerTrackingCode: string | null;
    updatedAt: Date;
    createdAt: Date;
  }): Promise<boolean> {
    if (
      !OrdersService.AWAITING_SELLER_SHIPMENT_STATUSES.includes(order.status)
    ) {
      return false;
    }

    const deadline = await this.resolveEffectiveShippingDeadline(order);
    if (!deadline) return false;
    if (deadline.getTime() > Date.now()) return false;

    if (order.type === OrderType.EXCHANGE) {
      const sellerSent = Boolean(order.trackingCode);
      const buyerSent = Boolean(order.sellerTrackingCode);
      if (sellerSent && buyerSent) return false;
      return true;
    }

    return !order.trackingCode;
  }

  private async findOrdersWithExpiredShippingDeadline() {
    const now = new Date();
    const candidates = await this.prisma.order.findMany({
      where: {
        status: { in: OrdersService.AWAITING_SELLER_SHIPMENT_STATUSES },
        OR: [{ shippingDeadline: { lte: now } }, { shippingDeadline: null }],
      },
      include: {
        listing: { select: { title: true } },
      },
    });

    const expired: typeof candidates = [];
    for (const order of candidates) {
      if (await this.isShippingDeadlineExpired(order)) {
        expired.push(order);
      }
    }
    return expired;
  }

  /**
   * لغو یک سفارش منقضی‌شده (بازگشت وجه، تیکت، امتیاز). در صورت عدم انقضا false برمی‌گرداند.
   */
  async tryCancelExpiredShippingForOrder(orderId: string): Promise<boolean> {
    const order = await this.prisma.order.findUnique({
      where: { id: orderId },
      include: { listing: { select: { title: true } } },
    });
    if (!order) return false;
    if (!(await this.isShippingDeadlineExpired(order))) return false;
    await this.cancelExpiredShippingOrder(order);
    return true;
  }

  private async cancelExpiredShippingOrder(
    order: Prisma.OrderGetPayload<{
      include: { listing: { select: { title: true } } };
    }>,
  ): Promise<void> {
    const exchangeNoShipmentCompensationPercent =
      await this.getExchangeNoShipmentCompensation();
    await this.prisma.$transaction(async (tx) => {
      await this.cancelExpiredShippingOrderInTx(
        tx,
        order,
        exchangeNoShipmentCompensationPercent,
      );
    });
  }

  private async cancelExpiredShippingOrderInTx(
    tx: Prisma.TransactionClient,
    order: Prisma.OrderGetPayload<{
      include: { listing: { select: { title: true } } };
    }>,
    exchangeNoShipmentCompensationPercent: number,
  ): Promise<void> {
    const current = await tx.order.findUnique({
      where: { id: order.id },
      select: { status: true },
    });
    if (
      !current ||
      !OrdersService.AWAITING_SELLER_SHIPMENT_STATUSES.includes(current.status)
    ) {
      return;
    }

    const sellerSent = Boolean(order.trackingCode);
    const buyerSentForExchange =
      order.type === OrderType.EXCHANGE && Boolean(order.sellerTrackingCode);
    const exchangeOnlyOneSent =
      order.type === OrderType.EXCHANGE && sellerSent !== buyerSentForExchange;

    let oneSideRefundSummary: {
      senderRefund: number;
      offenderRefund: number;
      compensation: number;
    } | null = null;

    if (order.type === OrderType.EXCHANGE && exchangeOnlyOneSent) {
      const senderId = sellerSent ? order.sellerId : order.buyerId;
      const offenderId = sellerSent ? order.buyerId : order.sellerId;
      const verificationFee = Number(order.verificationFee || 0);
      oneSideRefundSummary =
        await this.walletService.refundExchangeOneSideNoShipmentOnCancel(tx, {
          orderId: order.id,
          listingId: order.listingId,
          buyerId: order.buyerId,
          sellerId: order.sellerId,
          senderId,
          offenderId,
          verificationFee,
          inspectionPenaltyPercent: exchangeNoShipmentCompensationPercent,
        });
    } else if (order.type === OrderType.EXCHANGE) {
      const exchangeOffer = order.exchangeOfferId
        ? await tx.exchangeOffer.findUnique({
            where: { id: order.exchangeOfferId },
            select: { extraPayment: true, isPayerMe: true },
          })
        : null;
      await this.walletService.refundExchangeBothNoShipmentOnCancel(tx, {
        orderId: order.id,
        listingId: order.listingId,
        buyerId: order.buyerId,
        sellerId: order.sellerId,
        verificationFee: Number(order.verificationFee || 0),
        isPayerMe: Boolean(exchangeOffer?.isPayerMe),
        extraPayment: Number(exchangeOffer?.extraPayment || 0),
      });
    } else {
      const cancelReason = 'عدم ارسال فروشنده در مهلت مقرر؛ معامله لغو شد';
      await this.walletService.refundDirectOrderEscrowOnCancel(tx, {
        orderId: order.id,
        listingId: order.listingId,
        buyerId: order.buyerId,
        sellerId: order.sellerId,
        totalAmount: Number(order.totalAmount || 0),
        sellerRevenue: Number(order.sellerRevenue || 0),
        cancelReason,
        refundReason: 'shipping-timeout-cancel',
      });
    }

    const exchangeBothNoShipment =
      order.type === OrderType.EXCHANGE && !exchangeOnlyOneSent;
    const isDirectShippingTimeoutCancel =
      order.type !== OrderType.EXCHANGE || exchangeOnlyOneSent;

    if (order.type === OrderType.EXCHANGE && exchangeOnlyOneSent) {
      const offenderId = sellerSent ? order.buyerId : order.sellerId;
      await tx.user.update({
        where: { id: offenderId },
        data: { trustScore: { decrement: 15 } },
      });
    } else if (exchangeBothNoShipment) {
      await tx.user.update({
        where: { id: order.buyerId },
        data: { trustScore: { decrement: 15 } },
      });
      await tx.user.update({
        where: { id: order.sellerId },
        data: { trustScore: { decrement: 15 } },
      });
    } else {
      await tx.user.update({
        where: { id: order.sellerId },
        data: { trustScore: { decrement: 15 } },
      });
    }
    const targetStatus =
      order.type === OrderType.EXCHANGE && exchangeOnlyOneSent
        ? OrderStatus.REJECTED_AT_HUB
        : OrderStatus.CANCELLED;
    this.stateMachine.assertTransition(
      order.status,
      targetStatus,
      'auto-cancel-expired',
    );
    const prevShipCancel = order.status;
    await tx.order.update({
      where: { id: order.id },
      data: {
        status: targetStatus,
        cancelReason:
          order.type === OrderType.EXCHANGE && exchangeOnlyOneSent
            ? 'عدم ارسال یکی از طرفین در مهلت ۴۸ ساعته پس از ارسال طرف مقابل؛ مرجوعی کالای ارسال‌شده الزامی است'
            : exchangeBothNoShipment
              ? 'عدم ارسال هر دو طرف در مهلت مقرر؛ معامله معاوضه لغو شد'
              : 'عدم ارسال فروشنده در مهلت مقرر؛ معامله لغو شد',
        ...(order.type === OrderType.EXCHANGE && exchangeOnlyOneSent
          ? {
              exchangeHubInspection: {
                ...(order.exchangeHubInspection as Record<
                  string,
                  unknown
                > | null),
                resolution: 'RETURN_BOTH_TO_SENDERS',
                singleSideNoShipmentTimeout: true,
                skipInspection: true,
                returnOnlyLeg: sellerSent ? 'SELLER' : 'BUYER',
                returnSenderUserId: sellerSent ? order.sellerId : order.buyerId,
                awaitingReturnConfirmations: false,
                refundsReleasedAt: new Date().toISOString(),
              } as Prisma.InputJsonValue,
            }
          : {}),
      },
    });
    const failurePenalizeUserIds: string[] =
      order.type === OrderType.EXCHANGE && exchangeOnlyOneSent
        ? [sellerSent ? order.buyerId : order.sellerId]
        : exchangeBothNoShipment
          ? [order.buyerId, order.sellerId]
          : [order.sellerId];
    await this.orderReputation.recordTerminalOutcome(
      tx,
      {
        id: order.id,
        buyerId: order.buyerId,
        sellerId: order.sellerId,
        tradeReputationAt: order.tradeReputationAt,
      },
      prevShipCancel,
      'FAILURE',
      { failurePenalizeUserIds },
    );
    if (exchangeBothNoShipment) {
      await this.rejectListingAfterShippingTimeoutCancel(tx, {
        listingId: order.listingId,
        sellerId: order.sellerId,
        listingTitle: order.listing?.title ?? 'کالا',
        rejectionReason:
          'معامله معاوضه به‌دلیل عدم ارسال هر دو طرف در مهلت مقرر لغو شد. آگهی از انتشار خارج شد؛ برای فروش مجدد آن را ویرایش و دوباره ثبت کنید.',
        orderId: order.id,
      });
    } else if (order.type === OrderType.EXCHANGE && exchangeOnlyOneSent) {
      const offenderId = sellerSent ? order.buyerId : order.sellerId;
      if (offenderId === order.sellerId) {
        await this.rejectListingAfterShippingTimeoutCancel(tx, {
          listingId: order.listingId,
          sellerId: order.sellerId,
          listingTitle: order.listing?.title ?? 'کالا',
          rejectionReason:
            'معامله به‌دلیل عدم ارسال فروشنده در مهلت مقرر لغو شد. آگهی از انتشار خارج شد؛ برای فروش مجدد آن را ویرایش و دوباره ثبت کنید.',
          orderId: order.id,
        });
      } else {
        await tx.listing.update({
          where: { id: order.listingId },
          data: { status: ListingStatus.APPROVED },
        });
        if (order.exchangeOfferId) {
          await tx.exchangeOffer.updateMany({
            where: {
              listingId: order.listingId,
              status: ExchangeOfferStatus.WAITLISTED,
            },
            data: { status: ExchangeOfferStatus.PENDING },
          });
        }
      }
    } else if (order.type !== OrderType.EXCHANGE) {
      await this.rejectListingAfterShippingTimeoutCancel(tx, {
        listingId: order.listingId,
        sellerId: order.sellerId,
        listingTitle: order.listing?.title ?? 'کالا',
        rejectionReason:
          'معامله به‌دلیل عدم ارسال فروشنده در مهلت مقرر لغو شد. آگهی از انتشار خارج شد؛ برای فروش مجدد آن را ویرایش و دوباره ثبت کنید.',
        orderId: order.id,
      });
    }

    if (exchangeBothNoShipment && targetStatus === OrderStatus.CANCELLED) {
      const exchangeOffer = order.exchangeOfferId
        ? await tx.exchangeOffer.findUnique({
            where: { id: order.exchangeOfferId },
            select: { extraPayment: true, isPayerMe: true },
          })
        : null;
      const verificationFee = Number(order.verificationFee || 0);
      const extra = Number(exchangeOffer?.extraPayment || 0);
      const buyerShare =
        verificationFee + (exchangeOffer?.isPayerMe ? extra : 0);
      const sellerShare =
        verificationFee + (!exchangeOffer?.isPayerMe ? extra : 0);
      await this.createExchangeBothNoShipmentCancelTickets(tx, {
        orderId: order.id,
        buyerId: order.buyerId,
        sellerId: order.sellerId,
        listingTitle: order.listing?.title ?? 'کالا',
        buyerRefundAmount: buyerShare,
        sellerRefundAmount: sellerShare,
        trustPenaltyPoints: 15,
      });
    } else if (
      order.type === OrderType.EXCHANGE &&
      exchangeOnlyOneSent &&
      oneSideRefundSummary
    ) {
      const senderId = sellerSent ? order.sellerId : order.buyerId;
      const offenderId = sellerSent ? order.buyerId : order.sellerId;
      await this.createExchangeOneSideNoShipmentCancelTickets(tx, {
        orderId: order.id,
        buyerId: order.buyerId,
        sellerId: order.sellerId,
        senderId,
        offenderId,
        listingTitle: order.listing?.title ?? 'کالا',
        senderRefundAmount: oneSideRefundSummary.senderRefund,
        offenderRefundAmount: oneSideRefundSummary.offenderRefund,
        compensationAmount: oneSideRefundSummary.compensation,
        inspectionPenaltyPercent: exchangeNoShipmentCompensationPercent,
        trustPenaltyPoints: 15,
      });
    } else if (
      isDirectShippingTimeoutCancel &&
      targetStatus === OrderStatus.CANCELLED
    ) {
      await this.createShippingTimeoutCancelTickets(tx, {
        orderId: order.id,
        buyerId: order.buyerId,
        sellerId: order.sellerId,
        listingTitle: order.listing?.title ?? 'کالا',
        totalAmount: Number(order.totalAmount || 0),
        trustPenaltyPoints: 15,
      });
    }
  }

  @Cron(CronExpression.EVERY_MINUTE)
  async autoCancelExpiredOrders() {
    const expiredOrders = await this.findOrdersWithExpiredShippingDeadline();
    for (const order of expiredOrders) {
      try {
        await this.cancelExpiredShippingOrder(order);
      } catch (error) {
        console.error(`Error auto-canceling order ${order.id}:`, error);
      }
    }
  }

  @Cron(CronExpression.EVERY_HOUR)
  async autoCancelTimedOutExchangeCompletions() {
    const now = Date.now();
    const paymentDeadlineMinutes =
      await this.getExchangePaymentDeadlineMinutes();
    const timedOutAcceptedOffers = await this.prisma.exchangeOffer.findMany({
      where: {
        status: 'ACCEPTED',
      },
      include: {
        listing: {
          select: { id: true, title: true, status: true, authorId: true },
        },
      },
    });

    for (const offer of timedOutAcceptedOffers) {
      try {
        const paymentDeadlineMs =
          new Date(offer.updatedAt).getTime() +
          paymentDeadlineMinutes * 60 * 1000;
        if (now < paymentDeadlineMs) continue;

        await this.prisma.$transaction(async (tx) => {
          await this.processExchangePaymentTimeoutInTx(tx, offer);
        });
      } catch (error) {
        console.error(
          `Error auto-canceling exchange timeout for offer ${offer.id}:`,
          error,
        );
      }
    }
  }

  private async processExchangePaymentTimeoutInTx(
    tx: Prisma.TransactionClient,
    offer: {
      id: string;
      listingId: string;
      isPayerMe: boolean;
      extraPayment: unknown;
      offererId: string;
      listing: { id: string; title: string | null; authorId: string } | null;
    },
  ): Promise<void> {
    const linkedOrder = await tx.order.findFirst({
      where: { exchangeOfferId: offer.id },
    });

    if (
      linkedOrder &&
      linkedOrder.status !== OrderStatus.AWAITING_PAYMENT &&
      linkedOrder.status !== OrderStatus.PENDING
    ) {
      return;
    }

    const listingTitle = offer.listing?.title ?? 'کالا';
    const sellerId = offer.listing?.authorId;
    if (!sellerId) return;

    const verificationFee = Number(linkedOrder?.verificationFee || 0);
    const extra = Number(offer.extraPayment || 0);
    const buyerShare = verificationFee + (offer.isPayerMe ? extra : 0);
    const sellerShare = verificationFee + (!offer.isPayerMe ? extra : 0);
    const expectedTotal = buyerShare + sellerShare;
    const currentTotal = Number(linkedOrder?.totalAmount || 0);
    const offererId = offer.offererId;

    let buyerPaidAmount = 0;
    let sellerPaidAmount = 0;
    if (linkedOrder) {
      buyerPaidAmount =
        await this.walletService.resolveExchangeParticipantPaidAmount(tx, {
          participantUserId: linkedOrder.buyerId,
          orderId: linkedOrder.id,
          listingId: offer.listingId,
        });
      sellerPaidAmount =
        await this.walletService.resolveExchangeParticipantPaidAmount(tx, {
          participantUserId: linkedOrder.sellerId,
          orderId: linkedOrder.id,
          listingId: offer.listingId,
        });
    }

    const buyerPaidFully =
      currentTotal >= buyerShare &&
      Boolean(linkedOrder?.shippingAddress) &&
      buyerPaidAmount >= buyerShare;
    const sellerPaidFully =
      currentTotal >= expectedTotal &&
      Boolean(linkedOrder?.sellerShippingAddress) &&
      sellerPaidAmount >= sellerShare;

    if (buyerPaidFully && sellerPaidFully) {
      return;
    }

    type PaymentTimeoutScenario =
      | 'neither_paid'
      | 'buyer_paid_only'
      | 'seller_paid_only'
      | 'both_incomplete';

    let scenario: PaymentTimeoutScenario;
    let offenderIds: string[] = [];
    let rejectListing = false;
    let restoreWaitlisted = false;

    if (buyerPaidAmount <= 0 && sellerPaidAmount <= 0) {
      scenario = 'neither_paid';
      offenderIds = linkedOrder
        ? [linkedOrder.buyerId, linkedOrder.sellerId]
        : [offererId, sellerId];
      rejectListing = true;
    } else if (buyerPaidAmount > 0 && sellerPaidAmount <= 0) {
      scenario = 'buyer_paid_only';
      offenderIds = [linkedOrder?.sellerId ?? sellerId];
      rejectListing = true;
    } else if (sellerPaidAmount > 0 && buyerPaidAmount <= 0) {
      scenario = 'seller_paid_only';
      offenderIds = [linkedOrder?.buyerId ?? offererId];
      restoreWaitlisted = true;
    } else {
      scenario = 'both_incomplete';
      if (!buyerPaidFully) {
        offenderIds.push(linkedOrder!.buyerId);
      }
      if (!sellerPaidFully) {
        offenderIds.push(linkedOrder!.sellerId);
      }
      offenderIds = [...new Set(offenderIds)];
      rejectListing = offenderIds.includes(linkedOrder!.sellerId);
      restoreWaitlisted =
        offenderIds.length === 1 && offenderIds[0] === linkedOrder!.buyerId;
    }

    const penalty = OrdersService.EXCHANGE_PAYMENT_TIMEOUT_TRUST_PENALTY;
    for (const uid of offenderIds) {
      await tx.user.update({
        where: { id: uid },
        data: { trustScore: { decrement: penalty } },
      });
    }

    let buyerRefund = 0;
    let sellerRefund = 0;
    if (linkedOrder) {
      const refunds =
        await this.walletService.refundExchangePaymentTimeoutOnCancel(tx, {
          orderId: linkedOrder.id,
          listingId: offer.listingId,
          buyerId: linkedOrder.buyerId,
          sellerId: linkedOrder.sellerId,
          refundBuyer: buyerPaidAmount > 0,
          refundSeller: sellerPaidAmount > 0,
        });
      buyerRefund = refunds.buyerRefund;
      sellerRefund = refunds.sellerRefund;

      const prevExchangePayTimeout = linkedOrder.status;
      const cancelReason =
        scenario === 'neither_paid'
          ? 'اتمام مهلت پرداخت پس از پذیرش معاوضه؛ هیچ‌یک از طرفین پرداخت را تکمیل نکردند'
          : scenario === 'buyer_paid_only'
            ? 'اتمام مهلت پرداخت؛ فروشنده (صاحب آگهی) سهم خود را پرداخت نکرد'
            : scenario === 'seller_paid_only'
              ? 'اتمام مهلت پرداخت؛ پیشنهاددهنده سهم خود را پرداخت نکرد'
              : 'اتمام مهلت پرداخت؛ معامله به‌طور کامل تسویه نشد';

      await tx.order.update({
        where: { id: linkedOrder.id },
        data: { status: OrderStatus.CANCELLED, cancelReason },
      });
      await this.orderReputation.recordTerminalOutcome(
        tx,
        {
          id: linkedOrder.id,
          buyerId: linkedOrder.buyerId,
          sellerId: linkedOrder.sellerId,
          tradeReputationAt: linkedOrder.tradeReputationAt,
        },
        prevExchangePayTimeout,
        'FAILURE',
        offenderIds.length
          ? { failurePenalizeUserIds: offenderIds, ignoreEarlyAbort: true }
          : undefined,
      );
    }

    await tx.exchangeOffer.update({
      where: { id: offer.id },
      data: { status: ExchangeOfferStatus.CANCELLED },
    });

    if (rejectListing) {
      await this.rejectListingAfterShippingTimeoutCancel(tx, {
        listingId: offer.listingId,
        sellerId,
        listingTitle,
        rejectionReason:
          scenario === 'neither_paid'
            ? 'معامله معاوضه به‌دلیل عدم پرداخت هر دو طرف در مهلت مقرر لغو شد. آگهی از انتشار خارج شد؛ برای فروش مجدد آن را ویرایش و دوباره ثبت کنید.'
            : 'معامله معاوضه به‌دلیل عدم پرداخت فروشنده در مهلت مقرر لغو شد. آگهی از انتشار خارج شد؛ برای فروش مجدد آن را ویرایش و دوباره ثبت کنید.',
        orderId: linkedOrder?.id,
      });
    } else if (restoreWaitlisted) {
      await tx.listing.update({
        where: { id: offer.listingId },
        data: { status: ListingStatus.APPROVED },
      });

      await tx.exchangeOffer.updateMany({
        where: {
          listingId: offer.listingId,
          status: ExchangeOfferStatus.WAITLISTED,
        },
        data: { status: ExchangeOfferStatus.PENDING },
      });

      const waitlistedOfferers = await tx.exchangeOffer.findMany({
        where: {
          listingId: offer.listingId,
          status: ExchangeOfferStatus.PENDING,
          id: { not: offer.id },
        },
        select: { offererId: true },
      });
      const waitlistedUserIds = [
        ...new Set(waitlistedOfferers.map((r) => r.offererId)),
      ];
      if (waitlistedUserIds.length > 0) {
        await tx.notification.createMany({
          data: waitlistedUserIds.map((uid) => ({
            userId: uid,
            type: NotificationType.SYSTEM,
            title: 'پیشنهاد شما دوباره در انتظار بررسی است',
            message: `مهلت پرداخت معاوضه برای «${listingTitle}» به پایان رسید. پیشنهاد شما دوباره فعال شد و فروشنده می‌تواند یکی از درخواست‌ها را انتخاب کند.`,
            meta: {
              listingId: offer.listingId,
              reason: 'exchange-payment-timeout-waitlist-restore',
            } as Prisma.InputJsonValue,
          })),
        });
      }
    } else {
      await tx.listing.update({
        where: { id: offer.listingId },
        data: { status: ListingStatus.APPROVED },
      });
    }

    const ticketBuyerId = linkedOrder?.buyerId ?? offererId;
    const ticketSellerId = linkedOrder?.sellerId ?? sellerId;
    await this.createExchangePaymentTimeoutCancelTickets(tx, {
      orderId: linkedOrder?.id ?? null,
      buyerId: ticketBuyerId,
      sellerId: ticketSellerId,
      listingTitle,
      scenario,
      buyerRefundAmount: buyerRefund,
      sellerRefundAmount: sellerRefund,
      offenderIds,
    });
  }

  @Cron(CronExpression.EVERY_MINUTE)
  async autoConfirmOrders() {
    const now = new Date();
    const buyerConfirmDeadlineMinutes =
      await this.getBuyerConfirmDeadlineMinutes();
    const legacyThreshold = new Date(
      Date.now() - buyerConfirmDeadlineMinutes * 60 * 1000,
    );
    const pendingOrders = await this.prisma.order.findMany({
      where: {
        status: { in: OrdersService.BUYER_CONFIRM_ELIGIBLE_STATUSES },
        disputedAt: null,
        OR: [
          { buyerConfirmDeadline: { lte: now } },
          {
            buyerConfirmDeadline: null,
            updatedAt: { lte: legacyThreshold },
          },
        ],
      },
    });

    for (const order of pendingOrders) {
      try {
        if (!(await this.isBuyerConfirmDeadlineExpired(order))) continue;
        await this.processAutoConfirmOrder(order);
        console.log(`Auto-confirmed order ${order.id}`);
      } catch (error) {
        console.error(`Error auto-confirming order ${order.id}:`, error);
      }
    }
  }

  private async processAutoConfirmOrder(
    order: Prisma.OrderGetPayload<Record<string, never>>,
  ): Promise<void> {
    if (order.type === OrderType.EXCHANGE) {
      await this.prisma.$transaction(async (tx) => {
        const locked = await tx.order.findUnique({
          where: { id: order.id },
        });
        if (!locked) return;
        if (
          locked.status === OrderStatus.COMPLETED ||
          locked.status === OrderStatus.CANCELLED ||
          locked.disputedAt
        ) {
          return;
        }
        if (
          !OrdersService.BUYER_CONFIRM_ELIGIBLE_STATUSES.includes(locked.status)
        ) {
          return;
        }

        const [sellerWallet, buyerWallet] = await Promise.all([
          tx.wallet.findUnique({
            where: { userId: locked.sellerId },
            select: { balanceBlocked: true },
          }),
          tx.wallet.findUnique({
            where: { userId: locked.buyerId },
            select: { balanceBlocked: true },
          }),
        ]);
        const sellerBlocked = Math.max(
          0,
          Number(sellerWallet?.balanceBlocked || 0),
        );
        const buyerBlocked = Math.max(
          0,
          Number(buyerWallet?.balanceBlocked || 0),
        );
        if (sellerBlocked > 0) {
          await this.walletService.releaseEscrow(
            locked.sellerId,
            sellerBlocked,
            locked.listingId,
            tx,
            { orderId: locked.id },
          );
        }
        if (buyerBlocked > 0) {
          await this.walletService.releaseEscrow(
            locked.buyerId,
            buyerBlocked,
            locked.listingId,
            tx,
            { orderId: locked.id },
          );
        }
        const prevAutoConfirm = locked.status;
        await tx.order.update({
          where: { id: locked.id },
          data: {
            buyerConfirmedDelivery: true,
            sellerConfirmedDelivery: true,
            status: OrderStatus.COMPLETED,
          },
        });
        await this.orderReputation.recordTerminalOutcome(
          tx,
          {
            id: locked.id,
            buyerId: locked.buyerId,
            sellerId: locked.sellerId,
            tradeReputationAt: locked.tradeReputationAt,
          },
          prevAutoConfirm,
          'SUCCESS',
        );
      });
      return;
    }

    await this.confirmOrder(order.buyerId, order.id);
  }

  @Cron(CronExpression.EVERY_HOUR)
  async autoReleaseExchangeReturnEscrow() {
    const now = new Date();
    const deadlineMinutes =
      await this.getExchangeReturnConfirmDeadlineMinutes();
    const orders = await this.prisma.order.findMany({
      where: {
        type: OrderType.EXCHANGE,
        status: OrderStatus.CANCELLED,
        hubToBuyerTrackingCode: { not: null },
        hubToSellerTrackingCode: { not: null },
        AND: [
          {
            exchangeHubInspection: {
              path: ['resolution'],
              equals: 'RETURN_BOTH_TO_SENDERS',
            },
          },
          {
            exchangeHubInspection: {
              path: ['awaitingReturnConfirmations'],
              equals: true,
            },
          },
          {
            exchangeHubInspection: {
              path: ['refundsReleasedAt'],
              equals: null,
            },
          },
        ],
      },
      select: {
        id: true,
        buyerId: true,
        sellerId: true,
        listingId: true,
        exchangeOfferId: true,
        verificationFee: true,
        buyerConfirmedDelivery: true,
        sellerConfirmedDelivery: true,
        exchangeHubInspection: true,
      },
    });

    for (const order of orders) {
      try {
        await this.prisma.$transaction(async (tx) => {
          const locked = await tx.order.findUnique({
            where: { id: order.id },
            select: {
              id: true,
              status: true,
              type: true,
              buyerId: true,
              sellerId: true,
              listingId: true,
              exchangeOfferId: true,
              verificationFee: true,
              buyerConfirmedDelivery: true,
              sellerConfirmedDelivery: true,
              exchangeHubInspection: true,
            },
          });
          if (!locked) return;

          const inspection =
            (locked.exchangeHubInspection as Record<string, unknown> | null) ??
            {};
          if (
            locked.type !== OrderType.EXCHANGE ||
            locked.status !== OrderStatus.CANCELLED ||
            inspection['resolution'] !== 'RETURN_BOTH_TO_SENDERS' ||
            inspection['awaitingReturnConfirmations'] !== true ||
            inspection['refundsReleasedAt']
          ) {
            return;
          }

          const returnShipmentCompletedAtRaw =
            inspection['returnShipmentCompletedAt'];
          const returnShipmentCompletedAt =
            typeof returnShipmentCompletedAtRaw === 'string'
              ? new Date(returnShipmentCompletedAtRaw)
              : null;
          if (
            !returnShipmentCompletedAt ||
            Number.isNaN(returnShipmentCompletedAt.getTime())
          ) {
            return;
          }
          const autoReleaseAt = new Date(
            returnShipmentCompletedAt.getTime() + deadlineMinutes * 60 * 1000,
          );
          if (autoReleaseAt > now) return;

          const openTickets = await tx.ticket.count({
            where: {
              userId: { in: [locked.buyerId, locked.sellerId] },
              status: 'OPEN',
              subject: {
                contains: `[ORDER:${locked.id}]`,
                mode: 'insensitive',
              },
            },
          });
          if (openTickets > 0) return;

          const exchangeOffer = locked.exchangeOfferId
            ? await tx.exchangeOffer.findUnique({
                where: { id: locked.exchangeOfferId },
                select: { extraPayment: true, isPayerMe: true },
              })
            : null;

          const verificationFee = Number(locked.verificationFee || 0);
          const extra = Number(exchangeOffer?.extraPayment || 0);
          const buyerShare =
            verificationFee + (exchangeOffer?.isPayerMe ? extra : 0);
          const sellerShare =
            verificationFee + (!exchangeOffer?.isPayerMe ? extra : 0);
          const buyerRefundable = Math.max(0, buyerShare - verificationFee);
          const sellerRefundable = Math.max(0, sellerShare - verificationFee);

          await this.walletService.refundExchangeExtraOnCancel(tx, {
            buyerId: locked.buyerId,
            sellerId: locked.sellerId,
            listingId: locked.listingId,
            orderId: locked.id,
            isPayerMe: Boolean(exchangeOffer?.isPayerMe),
            buyerRefundable,
            sellerRefundable,
          });

          const mergedInspection = {
            ...inspection,
            buyerReturnReceived: true,
            sellerReturnReceived: true,
            awaitingReturnConfirmations: false,
            refundsReleasedAt: new Date().toISOString(),
            autoReleasedByTimeout: true,
          };

          await tx.order.update({
            where: { id: locked.id },
            data: {
              buyerConfirmedDelivery: true,
              sellerConfirmedDelivery: true,
              returnConfirmedAt: new Date(),
              returnConfirmedBy: 'AUTO_TIMEOUT',
              exchangeHubInspection: mergedInspection as Prisma.InputJsonValue,
            },
          });

          await tx.notification.createMany({
            data: [
              {
                userId: locked.buyerId,
                type: NotificationType.ORDER_STATUS_CHANGED,
                title: 'آزادسازی خودکار وجه مرجوعی',
                message:
                  'با پایان مهلت تایید دریافت و نبود اختلاف فعال، سهم پرداختی شما (بدون هزینه کارشناسی) آزاد شد.',
                meta: {
                  orderId: locked.id,
                  autoRelease: true,
                } as Prisma.InputJsonValue,
              },
              {
                userId: locked.sellerId,
                type: NotificationType.ORDER_STATUS_CHANGED,
                title: 'آزادسازی خودکار وجه مرجوعی',
                message:
                  'با پایان مهلت تایید دریافت و نبود اختلاف فعال، سهم پرداختی شما (بدون هزینه کارشناسی) آزاد شد.',
                meta: {
                  orderId: locked.id,
                  autoRelease: true,
                } as Prisma.InputJsonValue,
              },
            ],
          });
        });
      } catch (error) {
        console.error(
          `Error auto-releasing exchange return escrow for order ${order.id}:`,
          error,
        );
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
      where: {
        key: {
          in: ['BUYER_CONFIRM_DEADLINE_MINUTES', 'BUYER_CONFIRM_DEADLINE_DAYS'],
        },
      },
      orderBy: { key: 'asc' },
    });
    let minutes = this.parsePositiveIntSetting(
      setting?.value,
      OrdersService.DEFAULT_BUYER_CONFIRM_DEADLINE_MINUTES,
    );
    if (setting?.key === 'BUYER_CONFIRM_DEADLINE_DAYS') {
      minutes *= 24 * 60;
    }
    return minutes;
  }

  private async getExchangeNoShipmentCompensation(): Promise<number> {
    const findUnique = (this.prisma.systemSetting as any)?.findUnique;
    if (typeof findUnique !== 'function') {
      return OrdersService.DEFAULT_EXCHANGE_NO_SHIPMENT_COMPENSATION;
    }
    const setting = await findUnique.call(this.prisma.systemSetting, {
      where: { key: 'EXCHANGE_NO_SHIPMENT_COMPENSATION' },
      select: { value: true },
    });
    const parsed = this.parsePositiveIntSetting(
      setting?.value,
      OrdersService.DEFAULT_EXCHANGE_NO_SHIPMENT_COMPENSATION,
    );
    return Math.max(0, parsed);
  }

  private async getExchangePaymentDeadlineMinutes(): Promise<number> {
    const minutesSetting = await this.prisma.systemSetting.findUnique({
      where: { key: 'EXCHANGE_PAYMENT_DEADLINE_MINUTES' },
      select: { value: true },
    });
    if (minutesSetting?.value?.trim()) {
      return this.parsePositiveIntSetting(
        minutesSetting.value,
        OrdersService.DEFAULT_EXCHANGE_PAYMENT_DEADLINE_MINUTES,
      );
    }
    const hours = await this.getExchangeNoPaymentTimeoutHours();
    return hours * 60;
  }

  private async getExchangeNoPaymentTimeoutHours(): Promise<number> {
    const setting = await this.prisma.systemSetting.findUnique({
      where: { key: 'EXCHANGE_NO_PAYMENT_TIMEOUT_HOURS' },
      select: { value: true },
    });
    return this.parsePositiveIntSetting(
      setting?.value,
      OrdersService.DEFAULT_EXCHANGE_NO_PAYMENT_TIMEOUT_HOURS,
    );
  }

  private async getExchangeSecondPaymentTimeoutHours(): Promise<number> {
    const setting = await this.prisma.systemSetting.findUnique({
      where: { key: 'EXCHANGE_SECOND_PAYMENT_TIMEOUT_HOURS' },
      select: { value: true },
    });
    return this.parsePositiveIntSetting(
      setting?.value,
      OrdersService.DEFAULT_EXCHANGE_SECOND_PAYMENT_TIMEOUT_HOURS,
    );
  }

  private async getExchangeShipmentDeadlineMinutes(): Promise<number> {
    const minutesSetting = await this.prisma.systemSetting.findUnique({
      where: { key: 'EXCHANGE_SHIP_DEADLINE_MINUTES' },
      select: { value: true },
    });
    if (minutesSetting?.value?.trim()) {
      return this.parsePositiveIntSetting(
        minutesSetting.value,
        OrdersService.DEFAULT_SELLER_SHIP_DEADLINE_MINUTES,
      );
    }
    const hours = await this.getExchangeShipmentTimeoutHours();
    return hours * 60;
  }

  private async getExchangeShipmentTimeoutHours(): Promise<number> {
    const setting = await this.prisma.systemSetting.findUnique({
      where: { key: 'EXCHANGE_SHIPMENT_TIMEOUT_HOURS' },
      select: { value: true },
    });
    return this.parsePositiveIntSetting(
      setting?.value,
      OrdersService.DEFAULT_EXCHANGE_SHIPMENT_TIMEOUT_HOURS,
    );
  }

  private async getExchangeReturnConfirmDeadlineMinutes(): Promise<number> {
    const setting = await this.prisma.systemSetting.findFirst({
      where: {
        key: {
          in: [
            'EXCHANGE_RETURN_CONFIRM_DEADLINE_MINUTES',
            'EXCHANGE_RETURN_CONFIRM_DEADLINE_HOURS',
          ],
        },
      },
      orderBy: { key: 'asc' },
    });
    const fallback =
      OrdersService.DEFAULT_EXCHANGE_RETURN_CONFIRM_DEADLINE_MINUTES;
    const parsed = this.parsePositiveIntSetting(setting?.value, fallback);
    if (setting?.key === 'EXCHANGE_RETURN_CONFIRM_DEADLINE_HOURS') {
      return parsed * 60;
    }
    return parsed;
  }

  private async creditExchangeCompensation(
    tx: Prisma.TransactionClient,
    userId: string,
    amount: number,
    orderId: string,
    compensationPercent: number,
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
          compensationPercent,
          description: 'پرداخت جبرانی بابت عدم ارسال طرف مقابل',
        },
      },
    });
  }

  /**
   * اگر پس از commit تراکنش، درگاه لینک پرداخت ندهد، سفارش در AWAITING_PAYMENT
   * می‌ماند و checkout بعدی با «این کالا … در جریان است» بلاک می‌شود. این متد
   * سفارش را حذف می‌کند (هنوز پرداخت ثبت نشده). معاوضه: اگر حداقل یک پرداخت
   * در سفارش ثبت شده باشد، دست نمی‌زند.
   */
  private async releaseOrderAfterFailedGatewayInit(
    orderId: string,
  ): Promise<void> {
    await this.prisma.$transaction(async (tx) => {
      const locked = await tx.order.findUnique({ where: { id: orderId } });
      if (!locked) return;
      if (
        locked.status !== OrderStatus.AWAITING_PAYMENT &&
        locked.status !== OrderStatus.PENDING
      ) {
        return;
      }
      if (
        locked.type === OrderType.EXCHANGE &&
        Number(locked.totalAmount ?? 0) > 0
      ) {
        return;
      }

      if (locked.type === OrderType.AUCTION) {
        await tx.secondChanceOffer.updateMany({
          where: {
            listingId: locked.listingId,
            userId: locked.buyerId,
            status: SecondChanceOfferStatus.ACCEPTED,
          },
          data: {
            status: SecondChanceOfferStatus.OFFERED,
            acceptedAt: null,
          },
        });
      }

      await tx.order.delete({ where: { id: locked.id } });
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
