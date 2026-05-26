import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import {
  ExchangeOfferStatus,
  ListingType,
  OrderStatus,
  ListingStatus,
  Prisma,
  WalletTransactionStatus,
  WalletTransactionType,
} from '@prisma/client';
import { CreateExchangeOfferDto } from './create-exchange-offer.dto';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { ExchangeEvents } from './exchange.events';
import { prepareListingSlotForExchangeCheckout } from '../orders/exchange-listing-order.util';
import { reconcileExchangeOfferStatusWithOrder } from '../orders/exchange-order-sync.util';
import { resolveExchangeOfferListDisplay } from '../orders/exchange-offer-display.util';

@Injectable()
export class ExchangeService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly eventEmitter: EventEmitter2,
  ) {}

  // -----------------------------------
  // Create Offer
  // -----------------------------------
  async createOffer(
    userId: string,
    listingId: string,
    dto: CreateExchangeOfferDto,
    files: Array<Express.Multer.File>,
  ) {
    // 🛡️ 1. استخراج ایمن نام فایل‌ها (جلوگیری از ارور undefined)
    const fileNames = files?.length
      ? files.map((f) => f?.filename).filter(Boolean)
      : [];

    const listing = await this.prisma.listing.findUnique({
      where: { id: listingId },
      select: {
        id: true,
        authorId: true,
        type: true,
        status: true,
        exchangeOffersSince: true,
        direct: true,
      },
    });

    if (!listing) {
      throw new NotFoundException('آگهی یافت نشد');
    }

    const canExchange =
      listing.type === ListingType.EXCHANGE ||
      (listing.type === ListingType.DIRECT &&
        Boolean(listing.direct?.allowExchange));
    if (!canExchange) {
      throw new BadRequestException('این آگهی امکان معاوضه ندارد');
    }

    // 🛡️ 2. جلوگیری از پیشنهاد به خود
    if (String(listing.authorId) === String(userId)) {
      throw new ForbiddenException(
        'شما نمی‌توانید برای آگهی خودتان پیشنهاد معاوضه ثبت کنید.',
      );
    }

    // 🛡️ 3. جلوگیری از ثبت پیشنهاد تکراری باز
    const existingOffer = await this.prisma.exchangeOffer.findFirst({
      where: {
        offererId: userId,
        listingId: listingId,
        status: {
          in: [ExchangeOfferStatus.PENDING, ExchangeOfferStatus.WAITLISTED],
        },
        ...(listing.exchangeOffersSince
          ? { createdAt: { gte: listing.exchangeOffersSince } }
          : {}),
      },
    });

    if (existingOffer) {
      throw new BadRequestException(
        'شما قبلاً برای این آگهی پیشنهاد فعال (در انتظار یا در صف) دارید.',
      );
    }

    const offer = await this.prisma.exchangeOffer.create({
      data: {
        listingId,
        offererId: userId,
        title: dto.title,
        description: dto.description,
        images: fileNames,
        extraPayment: (() => {
          const n = Number(dto.extraPayment || 0);
          if (!Number.isFinite(n) || n < 0) {
            throw new BadRequestException('مبلغ مابه‌التفاوت نامعتبر است');
          }
          return n;
        })(),
        // ترجیح با فیلد صریح payerRole است؛ سپس fallback روی isPayerMe
        isPayerMe:
          dto.payerRole === 'OFFERER'
            ? true
            : dto.payerRole === 'OWNER'
              ? false
              : dto.isPayerMe === true ||
                String(dto.isPayerMe).toLowerCase() === 'true' ||
                String(dto.isPayerMe) === '1',
        status: ExchangeOfferStatus.PENDING,
      },
    });

    this.eventEmitter.emit(ExchangeEvents.OFFER_CREATED, {
      listingId,
      ownerId: listing.authorId,
      offererId: userId,
      offerId: offer.id,
    });

    return offer;
  }

  // -----------------------------------
  // Get offers (OWNER only)
  // -----------------------------------
  async getOffers(
    userId: string,
    listingId: string,
    options: { page?: number; pageSize?: number } = {},
  ) {
    const page = Math.max(1, options.page ?? 1);
    const pageSize = Math.min(50, Math.max(1, options.pageSize ?? 20));
    const skip = (page - 1) * pageSize;

    const listing = await this.prisma.listing.findUnique({
      where: { id: listingId },
      select: { authorId: true, exchangeOffersSince: true },
    });

    if (!listing) throw new NotFoundException('آگهی پیدا نشد');

    const isOwner = listing.authorId === userId;
    const where = {
      listingId,
      ...(listing.exchangeOffersSince
        ? { createdAt: { gte: listing.exchangeOffersSince } }
        : {}),
      ...(isOwner ? {} : { offererId: userId }),
    };

    const [items, total] = await Promise.all([
      this.prisma.exchangeOffer.findMany({
        where,
        skip,
        take: pageSize,
        orderBy: { createdAt: 'desc' },
        select: {
          id: true,
          listingId: true,
          offererId: true,
          status: true,
          title: true,
          description: true,
          images: true,
          extraPayment: true,
          isPayerMe: true,
          createdAt: true,
          offerer: {
            select: {
              id: true,
              firstName: true,
              lastName: true,
              avatar: true,
              rating: true,
            },
          },
        },
      }),
      this.prisma.exchangeOffer.count({ where }),
    ]);

    const offerIds = items.map((o) => o.id);
    const linkedOrders = offerIds.length
      ? await this.prisma.order.findMany({
          where: { exchangeOfferId: { in: offerIds } },
          select: {
            id: true,
            exchangeOfferId: true,
            status: true,
          },
        })
      : [];
    const orderByOfferId = new Map(
      linkedOrders.map((o) => [o.exchangeOfferId, o]),
    );
    const linkedOrderIds = linkedOrders.map((o) => o.id);
    const settlements = linkedOrderIds.length
      ? await this.prisma.walletTransaction.findMany({
          where: {
            wallet: { userId },
            type: WalletTransactionType.SETTLEMENT,
            status: WalletTransactionStatus.SUCCESS,
            AND: [{ meta: { path: ['kind'], equals: 'order-escrow' } }],
          },
          select: { meta: true },
        })
      : [];
    const paidOrderIds = new Set<string>();
    for (const s of settlements) {
      const meta = (s.meta as Record<string, unknown> | null) ?? {};
      const oid = typeof meta['orderId'] === 'string' ? meta['orderId'] : null;
      if (oid && linkedOrderIds.includes(oid)) paidOrderIds.add(oid);
    }

    const itemsWithPaymentState = items.map((offer) => {
      const linked = orderByOfferId.get(offer.id);
      return {
        ...offer,
        exchangeOrderId: linked?.id ?? null,
        exchangeOrderStatus: linked?.status ?? null,
        mySharePaid: linked?.id ? paidOrderIds.has(linked.id) : false,
      };
    });

    return {
      items: itemsWithPaymentState,
      pagination: {
        page,
        pageSize,
        total,
        totalPages: Math.max(1, Math.ceil(total / pageSize)),
      },
    };
  } // -----------------------------------
  // Accept Offer (فقط توافق، نه لزوماً ساخت سفارش)
  // -----------------------------------
  async acceptOffer(userId: string, offerId: string) {
    const offer = await this.prisma.exchangeOffer.findUnique({
      where: { id: offerId },
      include: {
        listing: {
          select: {
            id: true,
            authorId: true,
            title: true,
            status: true,
            exchangeOffersSince: true,
          },
        },
      },
    });

    if (!offer) throw new NotFoundException('پیشنهاد یافت نشد');
    if (
      offer.listing.exchangeOffersSince &&
      offer.createdAt < offer.listing.exchangeOffersSince
    ) {
      throw new NotFoundException('این پیشنهاد مربوط به دورهٔ قبلی آگهی است');
    }
    if (offer.listing.authorId !== userId)
      throw new ForbiddenException('شما مالک نیستید');
    if (offer.status !== ExchangeOfferStatus.PENDING)
      throw new BadRequestException('پیشنهاد قبلا تعیین تکلیف شده');

    // در همه‌ی معاوضه‌ها (حتی سر‌به‌سر)، هر دو طرف باید سهم خود از کارشناسی را پرداخت کنند.
    // بنابراین پس از پذیرش، سفارش نباید مستقیم نهایی شود و فقط به وضعیت ACCEPTED می‌رود.
    await this.prisma.$transaction(async (tx) => {
      await tx.exchangeOffer.update({
        where: { id: offerId },
        data: { status: ExchangeOfferStatus.ACCEPTED },
      });

      // سایر درخواست‌ها را رد قطعی نمی‌کنیم؛ در صف انتظار می‌مانند تا قفل شدن معامله یا انصراف خریدار اول
      // پیشنهادهای PENDING و ACCEPTED قبلی به صف می‌روند تا فقط یک معامله فعال باشد
      await tx.exchangeOffer.updateMany({
        where: {
          listingId: offer.listingId,
          id: { not: offerId },
          status: {
            in: [
              ExchangeOfferStatus.PENDING,
              ExchangeOfferStatus.ACCEPTED,
            ],
          },
          ...(offer.listing.exchangeOffersSince
            ? { createdAt: { gte: offer.listing.exchangeOffersSince } }
            : {}),
        },
        data: { status: ExchangeOfferStatus.WAITLISTED },
      });

      // سفارش نیمه‌کار از پیشنهاد قبلی (WAITLISTED) نباید پرداخت این معامله را مسدود کند
      await prepareListingSlotForExchangeCheckout(
        tx,
        offer.listingId,
        offerId,
      );
    });

    this.eventEmitter.emit(ExchangeEvents.OFFER_ACCEPTED, {
      listingId: offer.listingId,
      offererId: offer.offererId,
      offerId: offer.id,
    });

    return {
      ok: true,
      message:
        'پیشنهاد تایید شد. سایر درخواست‌ها در صف انتظار هستند تا پس از نهایی شدن پرداخت، در صورت شکست معامله دوباره در دسترس قرار گیرند.',
      status: 'ACCEPTED',
      needsPayment: true,
    };
  }

  /**
   * پس از قفل شدن معامله معاوضه (آگهی فروخته‌شده)، بقیهٔ صف و هر پیشنهاد معلق را رد قطعی می‌کند.
   */
  async rejectNonWinningExchangeOffersAfterSale(
    tx: Prisma.TransactionClient,
    listingId: string,
    winningOfferId: string,
  ) {
    await tx.exchangeOffer.updateMany({
      where: {
        listingId,
        id: { not: winningOfferId },
        status: {
          in: [ExchangeOfferStatus.WAITLISTED, ExchangeOfferStatus.PENDING],
        },
      },
      data: { status: ExchangeOfferStatus.REJECTED },
    });
  }

  // -----------------------------------
  // Finalize Exchange (ساخت سفارش نهایی)
  // -----------------------------------
  // ⚠️ نکته: این متد وقتی صدا زده می‌شود که پول پرداخت شده باشد (یا مبلغ ۰ باشد)
  async finalizeExchange(offerId: string) {
    const offer = await this.prisma.exchangeOffer.findUnique({
      where: { id: offerId },
      include: { listing: true },
    });

    if (!offer) throw new NotFoundException('پیشنهاد یافت نشد');

    return this.prisma.$transaction(async (tx) => {
      // 1. اطمینان از وضعیت ACCEPTED
      await tx.exchangeOffer.update({
        where: { id: offerId },
        data: { status: ExchangeOfferStatus.ACCEPTED },
      });

      // 2. رد کردن سایرین (محکم کاری)
      await tx.exchangeOffer.updateMany({
        where: {
          listingId: offer.listingId,
          id: { not: offerId },
          status: {
            in: [ExchangeOfferStatus.PENDING, ExchangeOfferStatus.WAITLISTED],
          },
        },
        data: { status: ExchangeOfferStatus.REJECTED },
      });

      // 3. وضعیت سفارش: چون پرداخت انجام شده (یا رایگان بوده)، مرحله بعد ارسال به انبار است
      const initialStatus: OrderStatus = 'AWAITING_SHIPMENT_TO_HUB';

      // 4. ساخت سفارش (رفع ارورهای قبلی با connect و sellerRevenue)
      const order = await tx.order.create({
        data: {
          listing: { connect: { id: offer.listingId } },
          buyer: { connect: { id: offer.offererId } }, // پیشنهاد دهنده
          seller: { connect: { id: offer.listing.authorId } }, // صاحب آگهی

          type: 'EXCHANGE',
          exchangeOfferId: offer.id,

          finalPrice: offer.extraPayment,
          totalAmount: offer.extraPayment,

          // مقادیر الزامی Prisma
          sellerRevenue: 0, // در معاوضه درآمد فروشنده از پلتفرم معمولا ۰ است (مگر محاسبه خاصی داشته باشی)
          platformFee: 0,

          status: initialStatus,
          requiresVerification: true, // معاوضه همیشه باید بیاید هاب

          shippingAddress: null,
          sellerShippingAddress: null,
        },
      });

      // 5. بستن آگهی
      await tx.listing.update({
        where: { id: offer.listingId },
        data: { status: ListingStatus.SOLD },
      });

      return {
        ok: true,
        orderId: order.id,
        message: 'معامله نهایی شد و سفارش ایجاد گردید.',
      };
    });
  }

  // -----------------------------------
  // Reject offer
  // -----------------------------------
  async rejectOffer(userId: string, offerId: string) {
    const offer = await this.prisma.exchangeOffer.findUnique({
      where: { id: offerId },
      include: { listing: true },
    });

    if (!offer) throw new NotFoundException('پیشنهاد یافت نشد');
    if (offer.listing.authorId !== userId)
      throw new ForbiddenException('دسترسی ندارید');

    if (
      offer.status !== ExchangeOfferStatus.PENDING &&
      offer.status !== ExchangeOfferStatus.WAITLISTED
    ) {
      throw new BadRequestException('وضعیت این پیشنهاد قابل تغییر نیست');
    }

    await this.prisma.exchangeOffer.update({
      where: { id: offerId },
      data: { status: ExchangeOfferStatus.REJECTED },
    });

    this.eventEmitter.emit(ExchangeEvents.OFFER_REJECTED, {
      listingId: offer.listingId,
      offererId: offer.offererId,
      offerId: offer.id,
    });

    return { ok: true, message: 'پیشنهاد رد شد' };
  }

  // 🆕 متد جدید: دریافت یک پیشنهاد خاص برای صفحه چک‌اوت
  // 🆕 متد دریافت یک پیشنهاد خاص برای صفحه چک‌اوت (با لایه امنیتی)
  async getOfferById(userId: string, offerId: string) {
    const offer = await this.prisma.exchangeOffer.findUnique({
      where: { id: offerId },
      include: {
        listing: { include: { direct: true, exchange: true } },
        offerer: {
          select: { id: true, firstName: true, lastName: true, avatar: true },
        },
      },
    });

    if (!offer) throw new NotFoundException('پیشنهاد معاوضه یافت نشد');

    // 🔒 چک کردن امنیت (IDOR): فقط پیشنهاد دهنده یا صاحب آگهی حق دیدن این صفحه را دارند
    if (offer.offererId !== userId && offer.listing.authorId !== userId) {
      throw new ForbiddenException(
        'شما اجازه مشاهده یا پرداخت این معامله را ندارید',
      );
    }

    if (
      offer.status === ExchangeOfferStatus.ACCEPTED ||
      offer.status === ExchangeOfferStatus.CANCELLED
    ) {
      await this.prisma.$transaction(async (tx) => {
        await reconcileExchangeOfferStatusWithOrder(tx, offer.id);
        await prepareListingSlotForExchangeCheckout(
          tx,
          offer.listingId,
          offer.id,
        );
      });
    }

    const offerAfterSync = await this.prisma.exchangeOffer.findUnique({
      where: { id: offerId },
      select: { status: true, updatedAt: true },
    });

    const linkedOrder = await this.prisma.order.findFirst({
      where: { exchangeOfferId: offer.id },
      select: {
        id: true,
        status: true,
        exchangeHubInspection: true,
        cancelReason: true,
      },
    });

    let mySharePaid = false;
    if (linkedOrder?.id) {
      const wallet = await this.prisma.wallet.findUnique({
        where: { userId },
        select: { id: true },
      });
      if (wallet) {
        const settlements = await this.prisma.walletTransaction.findMany({
          where: {
            walletId: wallet.id,
            type: WalletTransactionType.SETTLEMENT,
            status: WalletTransactionStatus.SUCCESS,
            OR: [
              { referenceId: linkedOrder.id },
              { referenceId: offer.listingId },
            ],
          },
          select: { meta: true },
        });
        mySharePaid = settlements.some((t) => {
          const meta = (t.meta ?? {}) as Record<string, unknown>;
          if (String(meta['kind'] ?? '') !== 'order-escrow') return false;
          if (String(meta['phase'] ?? '') !== 'exchange_participant_paid') {
            return false;
          }
          const payerUserId = String(meta['payerUserId'] ?? userId).trim();
          if (payerUserId !== userId) return false;
          const metaOrderId = String(meta['orderId'] ?? '').trim();
          const metaListingId = String(meta['listingId'] ?? '').trim();
          if (metaOrderId && metaOrderId !== linkedOrder.id) return false;
          if (metaListingId && metaListingId !== offer.listingId) return false;
          return true;
        });
      }
    }

    const effectiveOfferStatus =
      offerAfterSync?.status ?? offer.status;
    const display = resolveExchangeOfferListDisplay(
      effectiveOfferStatus,
      linkedOrder,
    );
    const effectiveStatus = display.status;

    const paymentDeadlineMinutes = await this.getExchangePaymentDeadlineMinutes();
    const paymentDeadlineBase =
      offerAfterSync?.updatedAt ?? offer.updatedAt;
    const paymentDeadlineAt =
      effectiveStatus === ExchangeOfferStatus.ACCEPTED
        ? new Date(
            new Date(paymentDeadlineBase).getTime() +
              paymentDeadlineMinutes * 60 * 1000,
          ).toISOString()
        : null;

    const orderCancelled =
      linkedOrder?.status === OrderStatus.CANCELLED ||
      display.exchangeCancelKind === 'PAYMENT_TIMEOUT' ||
      display.exchangeCancelKind === 'NO_SHIPMENT_TIMEOUT' ||
      display.exchangeCancelKind === 'BOTH_NO_SHIPMENT';
    let checkoutBlockedReason: string | null = null;
    if (display.exchangeCancelKind === 'PAYMENT_TIMEOUT') {
      checkoutBlockedReason =
        'مهلت پرداخت این معاوضه به پایان رسیده و معامله لغو شده است.';
    } else if (display.exchangeCancelKind === 'NO_SHIPMENT_TIMEOUT') {
      checkoutBlockedReason =
        'معامله به‌دلیل عدم ارسال در مهلت مقرر لغو شده است.';
    } else if (display.exchangeCancelKind === 'BOTH_NO_SHIPMENT') {
      checkoutBlockedReason =
        'معامله به‌دلیل عدم ارسال هر دو طرف در مهلت مقرر لغو شده است.';
    } else if (display.exchangeCancelKind === 'HUB_REJECT') {
      checkoutBlockedReason = 'این معامله در کارشناسی هاب رد شده است.';
    } else if (mySharePaid) {
      checkoutBlockedReason =
        'سهم شما برای این معاوضه قبلاً پرداخت شده است.';
    } else if (orderCancelled) {
      checkoutBlockedReason = 'سفارش معاوضه لغو شده است.';
    } else if (effectiveStatus === ExchangeOfferStatus.CANCELLED) {
      checkoutBlockedReason =
        'مهلت پرداخت این معاوضه به پایان رسیده و معامله لغو شده است.';
    } else if (effectiveStatus === ExchangeOfferStatus.REJECTED) {
      checkoutBlockedReason = 'این پیشنهاد معاوضه رد شده است.';
    } else if (effectiveStatus !== ExchangeOfferStatus.ACCEPTED) {
      checkoutBlockedReason = 'این معامله دیگر قابل ادامه نیست.';
    }

    const canCheckout =
      !mySharePaid &&
      effectiveStatus === ExchangeOfferStatus.ACCEPTED &&
      !orderCancelled;

    return {
      ...offer,
      status: effectiveStatus,
      exchangeCancelKind: display.exchangeCancelKind,
      exchangeOrderId: linkedOrder?.id ?? null,
      exchangeOrderStatus: linkedOrder?.status ?? null,
      mySharePaid,
      canCheckout,
      checkoutBlockedReason,
      paymentDeadlineAt,
    };
  }

  private async getExchangePaymentDeadlineMinutes(): Promise<number> {
    const minutesSetting = await this.prisma.systemSetting.findUnique({
      where: { key: 'EXCHANGE_PAYMENT_DEADLINE_MINUTES' },
      select: { value: true },
    });
    if (minutesSetting?.value?.trim()) {
      const parsed = Number(minutesSetting.value);
      if (Number.isFinite(parsed) && parsed > 0) {
        return Math.floor(parsed);
      }
    }
    const hoursSetting = await this.prisma.systemSetting.findUnique({
      where: { key: 'EXCHANGE_NO_PAYMENT_TIMEOUT_HOURS' },
      select: { value: true },
    });
    const hours = Number(hoursSetting?.value ?? 24);
    return Number.isFinite(hours) && hours > 0 ? Math.floor(hours * 60) : 24 * 60;
  }
}
