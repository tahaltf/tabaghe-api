import {
    BadRequestException,
    ForbiddenException,
    Injectable,
    NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { ExchangeOfferStatus, ListingType } from '@prisma/client';
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
      files: any[] // 👈 اضافه کردن آرگومان چهارم
    ) {
        const fileNames = files ? files.map(f => f.filename) : []; // 👈 تعریف متغیر که ارور TS2552 ندهد
        const listing = await this.prisma.listing.findUnique({
            where: { id: listingId },
        });

        if (!listing) {
            throw new NotFoundException('آگهی یافت نشد');
        }

        if (listing.type !== ListingType.EXCHANGE) {
            throw new BadRequestException('این آگهی برای معاوضه نیست');
        }

        // 👈 اصلاح شرط با استفاده از String() برای اطمینان از یکسان بودن تایپ‌ها
        if (String(listing.authorId) === String(userId)) {
            throw new ForbiddenException('شما نمی‌توانید برای آگهی خودتان پیشنهاد معاوضه ثبت کنید.');
        }

        // جلوگیری از ثبت پیشنهاد تکراری
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
                images: fileNames, // 👈 اینجا آرایه اسامی فایل‌ها رو ذخیره کن
                extraPayment: dto.extraPayment ?? 0,
                isPayerMe: dto.isPayerMe ?? true,
            },
        });

        // 🔔 notify owner
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
    async getOffers(userId: string, listingId: string) {
        const listing = await this.prisma.listing.findUnique({
            where: { id: listingId },
        });

        if (!listing) {
            throw new NotFoundException('Listing not found');
        }

        if (listing.authorId !== userId) {
            throw new ForbiddenException('Access denied');
        }

        return this.prisma.exchangeOffer.findMany({
            where: { listingId },
            orderBy: { createdAt: 'desc' },
            include: {
                offerer: {
                    select: {
                        id: true,
                        firstName: true, // اضافه شد برای نمایش بهتر در فرانت
                        lastName: true,
                        phone: true,
                        avatar: true,
                    },
                },
            },
        });
    }

    // -----------------------------------
    // Accept offer
    // -----------------------------------
    async acceptOffer(userId: string, offerId: string) {
        return this.prisma.$transaction(async (tx) => {
            const offer = await tx.exchangeOffer.findUnique({
                where: { id: offerId },
                include: { listing: true },
            });

            if (!offer) {
                throw new NotFoundException('Offer not found');
            }

            if (offer.listing.authorId !== userId) {
                throw new ForbiddenException('Access denied');
            }

            if (offer.status !== ExchangeOfferStatus.PENDING) {
                throw new BadRequestException('Offer already processed');
            }

            // accept selected offer
            await tx.exchangeOffer.update({
                where: { id: offerId },
                data: { status: ExchangeOfferStatus.ACCEPTED },
            });

            // reject all other pending offers
            await tx.exchangeOffer.updateMany({
                where: {
                    listingId: offer.listingId,
                    id: { not: offerId },
                    status: ExchangeOfferStatus.PENDING,
                },
                data: { status: ExchangeOfferStatus.REJECTED },
            });

            // ⚠️ نکته معماری: آگهی را اینجا DELETED_BY_USER یا SOLD نمی‌کنیم.
            // آگهی باید باز بماند تا در مرحله Checkout توسط کاربر قابل پرداخت باشد.
            // وضعیت SOLD در سرویس Orders بعد از پرداخت موفق ثبت می‌شود.

            // 🔔 notify offerer: accepted
            this.eventEmitter.emit(ExchangeEvents.OFFER_ACCEPTED, {
                listingId: offer.listingId,
                offererId: offer.offererId,
                offerId: offer.id,
            });

            return { ok: true, message: 'پیشنهاد با موفقیت تایید شد. اکنون نوبت پرداخت سرک و ثبت آدرس است.' };
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

        if (!offer) {
            throw new NotFoundException('Offer not found');
        }

        if (offer.listing.authorId !== userId) {
            throw new ForbiddenException('Access denied');
        }

        if (offer.status !== ExchangeOfferStatus.PENDING) {
            throw new BadRequestException('Offer already processed');
        }

        await this.prisma.exchangeOffer.update({
            where: { id: offerId },
            data: { status: ExchangeOfferStatus.REJECTED },
        });

        // 🔔 notify offerer: rejected
        this.eventEmitter.emit(ExchangeEvents.OFFER_REJECTED, {
            listingId: offer.listingId,
            offererId: offer.offererId,
            offerId: offer.id,
        });

        return { ok: true };
    }
}