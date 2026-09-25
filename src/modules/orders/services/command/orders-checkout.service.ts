import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import {
  AuctionBidStatus,
  AuctionSettlementStatus,
  AuctionStatus,
  ExchangeOfferStatus,
  ItemCondition,
  ListingStatus,
  ListingType,
  NotificationType,
  OrderStatus,
  OrderType,
  Prisma,
  SecondChanceOfferStatus,
  UserRole,
  WalletTransactionStatus,
  WalletTransactionType,
} from '@prisma/client';
import Decimal from 'decimal.js';
import { PrismaService } from '../../../../infrastructure/prisma/prisma.service';
import { readPositiveIntSetting } from '../../../../common/system-settings/numeric-setting.util';
import { WalletService } from '../../../wallet/wallet.service';
import { FeeCalculatorService } from '../../../fees/fee-calculator.service';
import { VerificationFeeCalculatorService } from '../../../fees/verification-fee-calculator.service';
import { AppSettingsService } from '../../../../shared/settings/app-settings.service';
import { PaymentsService } from '../../../payments/payments.service';
import type { ClientRequestMeta } from '../../../../common/http/client-ip.util';
import { NotificationService } from '../../../notification/notification.service';
import { ExchangeOrderNotifyService } from '../../../notification/exchange-order-notify.service';
import { OrderReputationService } from '../../order-reputation.service';
import { ExchangeService } from '../../../exchange/exchange.service';
import { QuotaService } from '../../../quota/quota.service';
import { ListingCommandService } from '../../../listing/services/listing-command.service';
import { OrdersStateMachineService } from '../../orders-state-machine.service';
import {
  clearedOrderVideoUpdateData,
  collectOrderVideoFilenames,
  deleteOrderVideoFile,
  orderHasStoredVideos,
} from '../../../../common/upload/order-video-storage.util';
import { enrichOrderUpdateForCompletion } from '../../order-lifecycle.util';
import { resolveListingEffectiveUnitPrice } from '../../../../common/listing/listing-price.util';
import {
  buildOrderTicketSubject,
  formatTicketMessageBody,
} from '../../../../common/ticket-message.util';
import {
  isPaymentTimeoutCancelledForActiveOffer,
  isPaymentTimeoutCancelledOrder,
  prepareListingSlotForExchangeCheckout,
} from '../../exchange-listing-order.util';
import {
  assertExchangeOrderOpenForCheckout,
  EXCHANGE_ACTIVE_FULFILLMENT_ORDER_STATUSES,
  EXCHANGE_PAYMENT_PENDING_ORDER_STATUSES,
  exchangeTerminalUserMessage,
  isExchangeOrderPaymentPending,
  isExchangeOrderTerminalForUserActions,
  isExchangePaymentTimeoutCancelReason,
  isResumableExchangeCheckoutOrder,
  reconcileExchangeOfferStatusWithOrder,
} from '../../exchange-order-sync.util';
import { formatMinutesDurationFa } from '../../../../common/duration-format.util';
import { OrdersSettingsService } from '../../orders-settings.service';
import { OrdersResponseEnrichmentService } from '../query/orders-response-enrichment.service';
import { CouponsService } from '../../../coupons/coupons.service';
import {
  DEFAULT_SELLER_SHIP_DEADLINE_MINUTES,
  AWAITING_SELLER_SHIPMENT_STATUSES,
  EXCHANGE_PEER_SHIP_WAIT_STATUSES,
  PURGE_COMPLETED_ORDER_VIDEOS_BATCH,
} from '../../orders.constants';
import { BUYER_CONFIRM_ELIGIBLE_STATUSES } from '../query/orders-response-enrichment.service';


@Injectable()
export class OrdersCheckoutService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly walletService: WalletService,
    private readonly feeCalculator: FeeCalculatorService,
    private readonly verificationFeeCalculator: VerificationFeeCalculatorService,
    private readonly appSettings: AppSettingsService,
    private readonly stateMachine: OrdersStateMachineService,
    private readonly paymentsService: PaymentsService,
    private readonly notificationService: NotificationService,
    private readonly exchangeOrderNotify: ExchangeOrderNotifyService,
    private readonly orderReputation: OrderReputationService,
    private readonly exchangeService: ExchangeService,
    private readonly quotaService: QuotaService,
    private readonly listingCommand: ListingCommandService,
    private readonly settings: OrdersSettingsService,
    private readonly couponsService: CouponsService,
  ) {}

  private resolveListingShippingFee(
    listing: { shippingCostOverride?: number | null },
    defaultFee: number,
  ): number {
    if (
      listing.shippingCostOverride != null &&
      listing.shippingCostOverride >= 0
    ) {
      return listing.shippingCostOverride;
    }
    return defaultFee;
  }

  async handleUniversalOrder(
    userId: string,
    dto: any,
    clientMeta?: ClientRequestMeta,
  ) {
    const {
      addressId,
      paymentMethod,
      orderType,
      exchangeOfferId,
      exchangeRequestId,
      requiresVerification,
    } = dto;
    const orderQuantity = Math.max(
      1,
      Math.floor(Number(dto.quantity) || 1),
    );

    let couponDiscountAmount = 0;
    let couponId: string | null = null;
    const deferSettlement = Boolean(dto.deferSettlement);
    if (
      dto.couponCode?.trim() &&
      orderType === OrderType.DIRECT &&
      dto.listingId &&
      !dto.skipPaymentInit &&
      !deferSettlement &&
      !dto.skipCoupon
    ) {
      const validated = await this.couponsService.validateForSingleOrder(
        userId,
        dto.couponCode.trim(),
        dto.listingId,
        orderQuantity,
      );
      couponDiscountAmount = validated.discountAmount;
      couponId = validated.couponId;
    }

    const finalExchangeId = exchangeOfferId || exchangeRequestId;
    let listingId = dto.listingId;
    let paymentUrl = null;

    const exchangeShipDeadlineMinutesPreload =
      orderType === 'EXCHANGE'
        ? await this.settings.getExchangeShipmentDeadlineMinutes()
        : 0;

    let order;
    try {
      order = await this.prisma.$transaction(async (tx) => {
      let finalPrice = 0;
      let shippingCost = 0;
      let sellerId = '';
      const buyerId = userId;
      let categoryId = '';
      let itemCondition: ItemCondition | null = null;
      let verificationFee = 0;
      let platformAddress = null;
      let sellerRequestedVerification = false;
      let auctionBlockedDeposit = 0;
      let auctionWinnerBidId: string | null = null;

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
      const shippingFee = shippingSetting
        ? Number(shippingSetting.value)
        : 50000;
      const sellerShipDeadlineMinutes = this.settings.parsePositiveIntSetting(
        sellerShipDeadlineSetting?.value,
        DEFAULT_SELLER_SHIP_DEADLINE_MINUTES,
      );

      // -----------------------------------------------------
      // سناریو ۱: معاوضه (پشتیبانی از پرداخت دوطرفه)
      // -----------------------------------------------------
      if (orderType === 'EXCHANGE') {
        const exchangeShipDeadlineMinutes =
          exchangeShipDeadlineMinutesPreload;
        const offer = await tx.exchangeOffer.findUnique({
          where: { id: finalExchangeId },
          include: {
            listing: { include: { direct: true, exchange: true } },
          },
        });

        if (!offer) throw new NotFoundException('درخواست معاوضه یافت نشد');
        if (!offer.listing) {
          throw new NotFoundException('آگهی این پیشنهاد معاوضه یافت نشد');
        }

        const linkedForTerminal = await tx.order.findFirst({
          where: { exchangeOfferId: finalExchangeId },
          select: {
            status: true,
            cancelReason: true,
            exchangeHubInspection: true,
          },
        });
        if (
          linkedForTerminal &&
          isExchangeOrderTerminalForUserActions(linkedForTerminal)
        ) {
          throw new BadRequestException(
            exchangeTerminalUserMessage(linkedForTerminal),
          );
        }

        await reconcileExchangeOfferStatusWithOrder(tx, finalExchangeId);
        let effectiveOfferStatus = offer.status;
        if (effectiveOfferStatus !== ExchangeOfferStatus.ACCEPTED) {
          const refreshedOffer = await tx.exchangeOffer.findUnique({
            where: { id: finalExchangeId },
            select: { status: true },
          });
          if (refreshedOffer?.status) {
            effectiveOfferStatus = refreshedOffer.status;
          }
        }

        if (effectiveOfferStatus !== ExchangeOfferStatus.ACCEPTED)
          throw new BadRequestException(
            effectiveOfferStatus === ExchangeOfferStatus.CANCELLED
              ? 'مهلت پرداخت این معاوضه تمام شده و معامله لغو شده است'
              : 'این معاوضه هنوز تایید نشده است',
          );

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

        // هر طرف بر اساس ارزش کالای خودش
        const sellerItemValue = Number(
          offer.listing.exchange?.ownValue ??
            offer.listing.direct?.price ??
            0,
        );
        const extra = Number(offer.extraPayment || 0);
        const offererItemValue = Math.max(
          0,
          offer.isPayerMe
            ? sellerItemValue - extra
            : sellerItemValue + extra,
        );
        const partyPrice = isBuyer ? offererItemValue : sellerItemValue;
        verificationFee = await this.verificationFeeCalculator.resolve(
          offer.listing.categoryId,
          partyPrice,
          tx,
        );
        platformAddress = hubAddress;

        const totalPayable = finalPrice + shippingCost + verificationFee;

        const executeExchangeWalletPayment = async (orderId: string) => {
          if (paymentMethod !== 'WALLET' || totalPayable <= 0) return;
          const wallet = await tx.wallet.upsert({
            where: { userId },
            create: {
              userId,
              balanceAvailable: 0,
              balanceBlocked: 0,
            },
            update: {},
          });
          if (Number(wallet.balanceAvailable) < totalPayable) {
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
            {
              isExchangeEscrow: true,
              blockedAmount: peerEscrowAmount,
              orderId,
            },
          );
        };

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

        // 🔍 سفارش فعال این پیشنهاد (پاکسازی سفارش‌های قدیمی روی همان آگهی)
        let existingExchangeOrder = await prepareListingSlotForExchangeCheckout(
          tx,
          listingId,
          finalExchangeId,
        );

        if (existingExchangeOrder) {
          assertExchangeOrderOpenForCheckout(
            existingExchangeOrder,
            finalExchangeId,
          );

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
          if (paymentMethod === 'WALLET' && totalPayable > 0) {
            await executeExchangeWalletPayment(existingExchangeOrder.id);
            updateData.totalAmount =
              Number(existingExchangeOrder.totalAmount) + totalPayable;
          } else if (paymentMethod === 'WALLET') {
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
          const paidTotalAfterUpdate = Number(updatedOrder.totalAmount ?? 0);
          const bothSidesPaid = paidTotalAfterUpdate >= expectedTotal;
          if (
            bothSidesProvidedAddress &&
            bothSidesPaid &&
            paymentMethod === 'WALLET'
          ) {
            const deadline = new Date(
              Date.now() + exchangeShipDeadlineMinutes * 60 * 1000,
            );
            const readyOrder = await tx.order.update({
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
            return readyOrder;
          }

          return updatedOrder;
        } else {
          let slotBlock = await tx.order.findFirst({
            where: {
              listingId,
              status: {
                notIn: [OrderStatus.COMPLETED, OrderStatus.CANCELLED],
              },
            },
            orderBy: { createdAt: 'desc' },
          });
          if (slotBlock?.status === OrderStatus.CANCELLED) {
            if (
              isPaymentTimeoutCancelledForActiveOffer(
                slotBlock,
                finalExchangeId,
              )
            ) {
              throw new BadRequestException(
                'مهلت پرداخت این معاوضه به پایان رسیده و امکان ثبت مجدد وجود ندارد.',
              );
            }
            await tx.order.delete({ where: { id: slotBlock.id } });
            slotBlock = null;
          }
          if (slotBlock) {
            if (
              slotBlock.exchangeOfferId === finalExchangeId &&
              isExchangeOrderTerminalForUserActions(slotBlock)
            ) {
              throw new BadRequestException(
                exchangeTerminalUserMessage(slotBlock),
              );
            }
            if (
              slotBlock.exchangeOfferId === finalExchangeId &&
              isResumableExchangeCheckoutOrder(slotBlock, finalExchangeId)
            ) {
              throw new BadRequestException(
                'سفارش این معاوضه از قبل وجود دارد. صفحه را تازه کنید و دوباره تلاش کنید.',
              );
            }
            throw new BadRequestException(
              'این کالا در حال حاضر در جریان معامله دیگری است.',
            );
          }

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
            totalAmount: 0, // پرداخت کیف پول بلافاصله پس از ساخت سفارش ثبت می‌شود
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
          if (paymentMethod === 'WALLET' && totalPayable > 0) {
            await executeExchangeWalletPayment(createdOrder.id);
            return tx.order.update({
              where: { id: createdOrder.id },
              data: { totalAmount: totalPayable },
            });
          }
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
        itemCondition = listing.condition;
        if (sellerId === userId)
          throw new ForbiddenException('شما نمی‌توانید آگهی خودتان را بخرید.');

        shippingCost =
          listing.shippingPayer === 'BUYER_PREPAID'
            ? this.resolveListingShippingFee(listing, shippingFee)
            : 0;
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

        const availableStock = listing.stockQuantity ?? 1;
        if (availableStock <= 0) {
          throw new BadRequestException('موجودی این کالا تمام شده است');
        }
        if (listing.singleItemSale !== false && orderQuantity > 1) {
          throw new BadRequestException(
            'این آگهی فقط به‌صورت تکی قابل خرید است',
          );
        }
        if (orderQuantity > availableStock) {
          throw new BadRequestException(
            `حداکثر ${availableStock} عدد از این کالا موجود است`,
          );
        }

        const unitPrice = listing.direct
          ? resolveListingEffectiveUnitPrice(listing.direct)
          : 0;
        finalPrice = unitPrice * orderQuantity;
        sellerId = listing.authorId;
        categoryId = listing.categoryId;
        itemCondition = listing.condition;
        if (sellerId === userId)
          throw new ForbiddenException('شما نمی‌توانید آگهی خودتان را بخرید.');

        shippingCost =
          listing.shippingPayer === 'BUYER_PREPAID'
            ? this.resolveListingShippingFee(listing, shippingFee)
            : 0;
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
            o.status === OrderStatus.CANCELLED ||
            o.status === OrderStatus.COMPLETED ||
            o.status === OrderStatus.DELIVERED
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
          const stockRow = await tx.listing.findUnique({
            where: { id: listingId },
            select: { type: true, stockQuantity: true },
          });
          const allowsConcurrentSales =
            stockRow?.type === 'DIRECT' &&
            (stockRow.stockQuantity ?? 1) > 1;

          if (!allowsConcurrentSales) {
            throw new BadRequestException(
              'این کالا در حال حاضر به فروش رسیده و در جریان است.',
            );
          }
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
      const isHubRequired = Boolean(
        requiresVerification || sellerRequestedVerification,
      );
      let feeChargedToBuyer = 0;
      let feeChargedToSeller = 0;

      if (dto.verificationFeeOverride !== undefined) {
        verificationFee = Math.max(0, Number(dto.verificationFeeOverride) || 0);
        if (isHubRequired) {
          platformAddress = hubAddress;
          if (verificationFee > 0) {
            if (sellerRequestedVerification) {
              feeChargedToSeller = verificationFee;
            } else if (requiresVerification) {
              feeChargedToBuyer = verificationFee;
            }
          }
        }
      } else if (isHubRequired && orderType !== 'EXCHANGE') {
        verificationFee = await this.verificationFeeCalculator.resolve(
          categoryId || null,
          finalPrice,
          tx,
        );
        platformAddress = hubAddress;

        if (sellerRequestedVerification) {
          feeChargedToSeller = verificationFee;
        } else if (requiresVerification) {
          feeChargedToBuyer = verificationFee;
        }
      }

      // مبلغ کل پرداختی خریدار
      let totalPayable =
        orderType === 'AUCTION'
          ? Math.max(0, finalPrice - auctionBlockedDeposit) +
            shippingCost +
            feeChargedToBuyer
          : finalPrice + shippingCost + feeChargedToBuyer;

      if (couponDiscountAmount > 0 && orderType === OrderType.DIRECT) {
        totalPayable = Math.max(0, totalPayable - couponDiscountAmount);
      }

      const platformFee =
        orderType === 'EXCHANGE'
          ? 0
          : await this.feeCalculator.calculateFee(
              orderType === 'AUCTION'
                ? ListingType.AUCTION
                : ListingType.DIRECT,
              categoryId,
              finalPrice,
              { sellerId, condition: itemCondition },
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

      if (paymentMethod === 'WALLET' && totalPayable > 0 && !deferSettlement) {
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
                meta: {
                  kind: 'auction-escrow',
                  phase: 'shipping_blocked',
                  listingId,
                  description: 'هزینه ارسال مزایده (بلوکه)',
                },
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

      if (deferSettlement) {
        // تسویه در سطح CheckoutSession انجام می‌شود.
        orderStatus = OrderStatus.AWAITING_PAYMENT;
      } else if (paymentMethod === 'WALLET') {
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
        quantity: orderType === 'DIRECT' ? orderQuantity : 1,
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
            ? await this.settings.getExchangeShipmentDeadlineMinutes()
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

      if (couponId && couponDiscountAmount > 0 && orderType === OrderType.DIRECT && !deferSettlement) {
        await tx.coupon.update({
          where: { id: couponId },
          data: { usedCount: { increment: 1 } },
        });
        await tx.couponRedemption.create({
          data: {
            couponId,
            userId,
            orderId: createdOrder.id,
            amount: couponDiscountAmount,
          },
        });
      }

      if (
        !deferSettlement &&
        paymentMethod === 'WALLET' &&
        (orderStatus === OrderStatus.PAID ||
          orderStatus === ('AWAITING_SHIPMENT_TO_HUB' as OrderStatus))
      ) {
        await this.walletService.linkEscrowDepositsToOrder(tx, {
          orderId: createdOrder.id,
          listingId,
          userIds: [buyerId, sellerId],
        });
      }

      if (
        orderStatus !== OrderStatus.PENDING &&
        orderStatus !== OrderStatus.AWAITING_PAYMENT
      ) {
        if (orderType === 'AUCTION') {
          await tx.listingAuction.update({
            where: { listingId },
            data: { settlementStatus: AuctionSettlementStatus.PAID },
          });
          await tx.listing.update({
            where: { id: listingId },
            data: { status: ListingStatus.SOLD },
          });
        } else if (orderType === 'DIRECT') {
          const listingRow = await tx.listing.findUnique({
            where: { id: listingId },
            select: { stockQuantity: true },
          });
          const purchasedQty = orderQuantity;
          const nextStock = Math.max(
            0,
            (listingRow?.stockQuantity ?? 1) - purchasedQty,
          );
          await tx.listing.update({
            where: { id: listingId },
            data: {
              stockQuantity: nextStock,
              status:
                nextStock <= 0 ? ListingStatus.SOLD : ListingStatus.APPROVED,
            },
          });
        } else {
          await tx.listing.update({
            where: { id: listingId },
            data: { status: ListingStatus.SOLD },
          });
        }
      }

      return createdOrder;
    });
    } catch (err) {
      if (
        err instanceof BadRequestException ||
        err instanceof NotFoundException ||
        err instanceof ForbiddenException
      ) {
        throw err;
      }
      if (
        err instanceof Prisma.PrismaClientKnownRequestError &&
        err.code === 'P2002'
      ) {
        throw new BadRequestException(
          'این کالا در حال حاضر در جریان معامله است. لطفاً چند لحظه بعد دوباره تلاش کنید.',
        );
      }
      if (
        err instanceof Prisma.PrismaClientKnownRequestError &&
        err.code === 'P2025'
      ) {
        throw new BadRequestException(
          'اطلاعات معامله ناقص یا منقضی شده است. صفحه را تازه کنید.',
        );
      }
      if (err instanceof Prisma.PrismaClientValidationError) {
        throw new BadRequestException(
          'اطلاعات سفارش نامعتبر است. لطفاً صفحه را تازه کنید و دوباره تلاش کنید.',
        );
      }
      throw err;
    }

    // در معاوضه، مبلغ قابل پرداخت هر طرف جداگانه در PaymentsService محاسبه می‌شود
    // و ممکن است totalAmount سفارش (در لحظه ساخت/به‌روزرسانی) معیار خوبی نباشد.
    if (
      paymentMethod === 'GATEWAY' &&
      !dto.skipPaymentInit &&
      !deferSettlement &&
      (order.type === OrderType.EXCHANGE || Number(order.totalAmount) > 0)
    ) {
      try {
        const initiated = await this.paymentsService.initiateOrderPayment(
          order.id,
          userId,
          undefined,
          undefined,
          clientMeta,
          dto.gateway,
        );
        paymentUrl = initiated.paymentUrl;
      } catch (err) {
        await this.releaseOrderAfterFailedGatewayInit(order.id);
        throw err;
      }
    }

    const shouldNotifyPurchase =
      !deferSettlement &&
      order.type !== OrderType.EXCHANGE &&
      order.status !== OrderStatus.PENDING &&
      order.status !== OrderStatus.AWAITING_PAYMENT;
    if (shouldNotifyPurchase) {
      await this.notifyOrderPurchasedAndSold(order);
    } else if (order.type === OrderType.EXCHANGE) {
      await this.notifyExchangeCheckoutProgress(order.id, userId, paymentMethod);
    }

    return {
      ...order,
      paymentUrl: paymentUrl,
    };
  } // 4. ثبت کد رهگیری

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

  private async notifyExchangeCheckoutProgress(
    orderId: string,
    payerUserId: string,
    paymentMethod: string,
  ): Promise<void> {
    const fresh = await this.prisma.order.findUnique({
      where: { id: orderId },
      select: {
        id: true,
        buyerId: true,
        sellerId: true,
        listingId: true,
        status: true,
        type: true,
      },
    });
    if (!fresh || fresh.type !== OrderType.EXCHANGE) return;

    if (fresh.status === OrderStatus.AWAITING_SHIPMENT_TO_HUB) {
      await this.exchangeOrderNotify.notifyReadyToShip(fresh);
      return;
    }

    if (
      fresh.status === OrderStatus.AWAITING_PAYMENT &&
      paymentMethod === 'WALLET'
    ) {
      await this.exchangeOrderNotify.notifyParticipantPaid(fresh, payerUserId);
    }
  }

  private async notifyOrderPurchasedAndSold(order: {
    id: string;
    buyerId: string;
    sellerId: string;
    listingId: string;
    type?: OrderType;
    totalAmount?: unknown;
  }): Promise<void> {
    const listing = await this.prisma.listing.findUnique({
      where: { id: order.listingId },
      select: { title: true },
    });
    const listingTitle = listing?.title ?? 'کالا';
    const orderRow = await this.prisma.order.findUnique({
      where: { id: order.id },
      select: { totalAmount: true, type: true },
    });
    const totalAmount = Number(orderRow?.totalAmount ?? order.totalAmount ?? 0);
    const sharedMeta = {
      orderId: order.id,
      listingId: order.listingId,
      listingTitle,
      amount: totalAmount,
      totalAmount,
    };

    await Promise.all([
      this.notificationService.create({
        userId: order.buyerId,
        type: NotificationType.ORDER_STATUS_CHANGED,
        title: 'خرید شما ثبت شد',
        message: `خرید شما برای «${listingTitle}» با موفقیت ثبت شد.`,
        meta: {
          ...sharedMeta,
          role: 'BUYER',
          status: 'PAID',
          phase: 'purchase_registered',
          phaseKey: 'purchase_registered',
        },
      }),
      this.notificationService.create({
        userId: order.sellerId,
        type: NotificationType.ORDER_STATUS_CHANGED,
        title: 'کالای شما فروخته شد',
        message: `کالای «${listingTitle}» با موفقیت فروخته شد.`,
        meta: {
          ...sharedMeta,
          role: 'SELLER',
          status: 'SOLD',
          statusLabel: 'فروخته شد',
          sellerOrderStatusFa: 'فروخته شد',
          phase: 'sale_registered',
          phaseKey: 'sale_registered',
        },
      }),
      this.notificationService.notifyAdminNewOrder({
        orderId: order.id,
        listingId: order.listingId,
        listingTitle,
        buyerId: order.buyerId,
        sellerId: order.sellerId,
        totalAmount,
        orderType: String(orderRow?.type ?? order.type ?? 'DIRECT'),
      }),
    ]);
  }

}
