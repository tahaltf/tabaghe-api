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
    WalletTransactionStatus,
    WalletTransactionType,
} from '@prisma/client';
import { CreateExchangeOfferDto } from './create-exchange-offer.dto';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { ExchangeEvents } from './exchange.events';

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
      files: Array<Express.Multer.File>
    ) {
        // 🛡️ 1. استخراج ایمن نام فایل‌ها (جلوگیری از ارور undefined)
        const fileNames = files?.length
          ? files.map(f => f?.filename).filter(Boolean)
          : [];

        const listing = await this.prisma.listing.findUnique({
            where: { id: listingId },
            include: { direct: true },
        });

        if (!listing) {
            throw new NotFoundException('آگهی یافت نشد');
        }

        const canExchange =
          listing.type === ListingType.EXCHANGE ||
          (listing.type === ListingType.DIRECT && Boolean(listing.direct?.allowExchange));
        if (!canExchange) {
            throw new BadRequestException('این آگهی امکان معاوضه ندارد');
        }

        // 🛡️ 2. جلوگیری از پیشنهاد به خود
        if (String(listing.authorId) === String(userId)) {
            throw new ForbiddenException('شما نمی‌توانید برای آگهی خودتان پیشنهاد معاوضه ثبت کنید.');
        }

        // 🛡️ 3. جلوگیری از ثبت پیشنهاد تکراری باز
        const existingOffer = await this.prisma.exchangeOffer.findFirst({
            where: {
                offererId: userId,
                listingId: listingId,
                status: ExchangeOfferStatus.PENDING,
            },
        });

        if (existingOffer) {
            throw new BadRequestException('شما قبلاً یک پیشنهاد در حال بررسی برای این آگهی ثبت کرده‌اید.');
        }

        const offer = await this.prisma.exchangeOffer.create({
            data: {
                listingId,
                offererId: userId,
                title: dto.title,
                description: dto.description,
                images: fileNames,
                extraPayment: Number(dto.extraPayment || 0),
                // ترجیح با فیلد صریح payerRole است؛ سپس fallback روی isPayerMe
                isPayerMe:
                  dto.payerRole === 'OFFERER'
                    ? true
                    : dto.payerRole === 'OWNER'
                      ? false
                      : dto.isPayerMe === true ||
                        String(dto.isPayerMe).toLowerCase() === 'true' ||
                        String(dto.isPayerMe) === '1',
                status: ExchangeOfferStatus.PENDING
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
            select: { authorId: true },
        });

        if (!listing) throw new NotFoundException('آگهی پیدا نشد');

        const isOwner = listing.authorId === userId;
        const where = {
            listingId,
            ...(isOwner ? {} : { offererId: userId }),
        };

        const [items, total] = await this.prisma.$transaction([
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
        const orderByOfferId = new Map(linkedOrders.map((o) => [o.exchangeOfferId, o]));
        const linkedOrderIds = linkedOrders.map((o) => o.id);
        const settlements = linkedOrderIds.length
          ? await this.prisma.walletTransaction.findMany({
              where: {
                wallet: { userId },
                type: WalletTransactionType.SETTLEMENT,
                status: WalletTransactionStatus.SUCCESS,
                AND: [
                  { meta: { path: ['kind'], equals: 'order-escrow' } },
                ],
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
    }    // -----------------------------------
    // Accept Offer (فقط توافق، نه لزوماً ساخت سفارش)
    // -----------------------------------
    async acceptOffer(userId: string, offerId: string) {
        const offer = await this.prisma.exchangeOffer.findUnique({
            where: { id: offerId },
            include: { listing: true },
        });

        if (!offer) throw new NotFoundException('پیشنهاد یافت نشد');
        if (offer.listing.authorId !== userId) throw new ForbiddenException('شما مالک نیستید');
        if (offer.status !== ExchangeOfferStatus.PENDING) throw new BadRequestException('پیشنهاد قبلا تعیین تکلیف شده');

        // در همه‌ی معاوضه‌ها (حتی سر‌به‌سر)، هر دو طرف باید سهم خود از کارشناسی را پرداخت کنند.
        // بنابراین پس از پذیرش، سفارش نباید مستقیم نهایی شود و فقط به وضعیت ACCEPTED می‌رود.
        await this.prisma.exchangeOffer.update({
            where: { id: offerId },
            data: { status: ExchangeOfferStatus.ACCEPTED }
        });

        // رد کردن سایر پیشنهادها
        await this.prisma.exchangeOffer.updateMany({
            where: {
                listingId: offer.listingId,
                id: { not: offerId },
                status: ExchangeOfferStatus.PENDING,
            },
            data: { status: ExchangeOfferStatus.REJECTED },
        });

        this.eventEmitter.emit(ExchangeEvents.OFFER_ACCEPTED, {
            listingId: offer.listingId,
            offererId: offer.offererId,
            offerId: offer.id,
        });

        return {
            ok: true,
            message: 'پیشنهاد تایید شد. تکمیل معامله پس از پرداخت سهم هر دو طرف انجام می‌شود.',
            status: 'ACCEPTED',
            needsPayment: true
        };
    }

    // -----------------------------------
    // Finalize Exchange (ساخت سفارش نهایی)
    // -----------------------------------
    // ⚠️ نکته: این متد وقتی صدا زده می‌شود که پول پرداخت شده باشد (یا مبلغ ۰ باشد)
    async finalizeExchange(offerId: string) {
        const offer = await this.prisma.exchangeOffer.findUnique({
            where: { id: offerId },
            include: { listing: true }
        });

        if (!offer) throw new NotFoundException('پیشنهاد یافت نشد');

        return this.prisma.$transaction(async (tx) => {
            // 1. اطمینان از وضعیت ACCEPTED
            await tx.exchangeOffer.update({
                where: { id: offerId },
                data: { status: ExchangeOfferStatus.ACCEPTED }
            });

            // 2. رد کردن سایرین (محکم کاری)
            await tx.exchangeOffer.updateMany({
                where: {
                    listingId: offer.listingId,
                    id: { not: offerId },
                    status: ExchangeOfferStatus.PENDING,
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
                    sellerShippingAddress: null
                }
            });

            // 5. بستن آگهی
            await tx.listing.update({
                where: { id: offer.listingId },
                data: { status: ListingStatus.SOLD }
            });

            return {
                ok: true,
                orderId: order.id,
                message: 'معامله نهایی شد و سفارش ایجاد گردید.'
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
        if (offer.listing.authorId !== userId) throw new ForbiddenException('دسترسی ندارید');

        if (offer.status !== ExchangeOfferStatus.PENDING) {
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
                    select: { id: true, firstName: true, lastName: true, avatar: true }
                }
            }
        });

        if (!offer) throw new NotFoundException('پیشنهاد معاوضه یافت نشد');

        // 🔒 چک کردن امنیت (IDOR): فقط پیشنهاد دهنده یا صاحب آگهی حق دیدن این صفحه را دارند
        if (offer.offererId !== userId && offer.listing.authorId !== userId) {
            throw new ForbiddenException('شما اجازه مشاهده یا پرداخت این معامله را ندارید');
        }

        const linkedOrder = await this.prisma.order.findFirst({
          where: { exchangeOfferId: offer.id },
          select: { id: true, status: true },
        });
        let mySharePaid = false;
        if (linkedOrder?.id) {
          const mySettlement = await this.prisma.walletTransaction.findFirst({
            where: {
              wallet: { userId },
              type: WalletTransactionType.SETTLEMENT,
              status: WalletTransactionStatus.SUCCESS,
              AND: [
                { meta: { path: ['kind'], equals: 'order-escrow' } },
                { meta: { path: ['orderId'], equals: linkedOrder.id } },
              ],
            },
            select: { id: true },
          });
          mySharePaid = Boolean(mySettlement);
        }

        return {
          ...offer,
          exchangeOrderId: linkedOrder?.id ?? null,
          exchangeOrderStatus: linkedOrder?.status ?? null,
          mySharePaid,
        };
    }}