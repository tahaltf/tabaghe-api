import {
    BadRequestException,
    ForbiddenException,
    Injectable,
    NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
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
    ) {
        const listing = await this.prisma.listing.findUnique({
            where: { id: listingId },
        });

        if (!listing) {
            throw new NotFoundException('Listing not found');
        }

        if (listing.type !== ListingType.EXCHANGE) {
            throw new BadRequestException('Not an exchange listing');
        }

        if (listing.authorId === userId) {
            throw new ForbiddenException('Cannot offer on your own listing');
        }

        const offer = await this.prisma.exchangeOffer.create({
            data: {
                listingId,
                offererId: userId,
                title: dto.title,
                description: dto.description,
                images: dto.images,
                extraPayment: dto.extraPayment ?? 0,
            },
        });

        // 🔔 notify owner: new offer received
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
                        phone: true,
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

            // close listing
            await tx.listing.update({
                where: { id: offer.listingId },
                data: { status: 'DELETED_BY_USER' },
            });

            // 🔔 notify offerer: accepted
            this.eventEmitter.emit(ExchangeEvents.OFFER_ACCEPTED, {
                listingId: offer.listingId,
                offererId: offer.offererId,
                offerId: offer.id,
            });

            return { ok: true };
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
