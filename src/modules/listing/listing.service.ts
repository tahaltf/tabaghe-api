// src/modules/listing/listing.service.ts

import {
    BadRequestException,
    ForbiddenException,
    Injectable,
    NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { QuotaService } from '../quota/quota.service';

import { CreateListingDto } from './dto/create-listing.dto';
import { UpdateListingDto } from './dto/update-listing.dto';
import { DeleteListingDto } from './dto/delete-listing.dto';

import { ListingStatus, ListingType, UserRole } from '@prisma/client';

@Injectable()
export class ListingService {
    constructor(
        private readonly prisma: PrismaService,
        private readonly quotaService: QuotaService, // 👈 اضافه شد
    ) {}

    // =========================
    // Create Listing
    // =========================
    async create(userId: string, dto: CreateListingDto) {
        this.validateTypePayload(dto);

        return this.prisma.$transaction(async (tx) => {
            const listing = await tx.listing.create({
                data: {
                    authorId: userId,
                    type: dto.type,
                    status: ListingStatus.PENDING,
                    title: dto.title,
                    categoryId: dto.categoryId,
                    condition: dto.condition,
                    description: dto.description,
                    province: dto.province,
                    city: dto.city,
                    thumbnail: dto.thumbnail,
                    gallery: dto.gallery ?? [],
                    direct: dto.direct ? { create: dto.direct } : undefined,
                    exchange: dto.exchange ? { create: dto.exchange } : undefined,
                    auction: dto.auction ? { create: dto.auction } : undefined,
                },
            });


            await this.quotaService.consumeOnCreate(
                tx,
                userId,
                dto.type,
                listing.id,
            );

            return listing;
        });
    }


    // =========================
    // Validation
    // =========================
    private validateTypePayload(dto: CreateListingDto) {
        switch (dto.type) {
            case ListingType.DIRECT:
                if (!dto.direct) {
                    throw new BadRequestException('Direct payload required');
                }
                break;

            case ListingType.EXCHANGE:
                if (!dto.exchange) {
                    throw new BadRequestException('Exchange payload required');
                }
                if (dto.exchange.allowDirectSale && !dto.exchange.directPrice) {
                    throw new BadRequestException(
                        'directPrice required when allowDirectSale is true',
                    );
                }
                break;

            case ListingType.AUCTION:
                if (!dto.auction) {
                    throw new BadRequestException('Auction payload required');
                }
                if (dto.auction.buyNowEnabled && !dto.auction.buyNowPrice) {
                    throw new BadRequestException(
                        'buyNowPrice required when buyNowEnabled is true',
                    );
                }
                break;
        }
    }

    // =========================
    // Update Listing
    // =========================
    async update(
        userId: string,
        listingId: string,
        dto: UpdateListingDto,
    ) {
        const listing = await this.prisma.listing.findUnique({
            where: { id: listingId },
            include: {
                direct: true,
                exchange: true,
                auction: true,
            },
        });

        if (!listing) {
            throw new NotFoundException('Listing not found');
        }

        if (listing.authorId !== userId) {
            throw new ForbiddenException('You are not the owner of this listing');
        }

        if (
            listing.status !== ListingStatus.DRAFT &&
            listing.status !== ListingStatus.PENDING
        ) {
            throw new ForbiddenException(
                'Listing cannot be edited in this status',
            );
        }

        return this.prisma.listing.update({
            where: { id: listingId },
            data: {
                title: dto.title,
                description: dto.description,
                province: dto.province,
                city: dto.city,
                thumbnail: dto.thumbnail,
                gallery: dto.gallery,

                direct: dto.direct ? { update: dto.direct } : undefined,
                exchange: dto.exchange ? { update: dto.exchange } : undefined,
                auction: dto.auction ? { update: dto.auction } : undefined,
            },
        });
    }

    // =========================
    // Delete Listing (User)
    // =========================
    async delete(
        userId: string,
        listingId: string,
        dto: DeleteListingDto,
    ) {
        const listing = await this.prisma.listing.findUnique({
            where: { id: listingId },
        });

        if (!listing) {
            throw new NotFoundException('Listing not found');
        }

        if (listing.authorId !== userId) {
            throw new ForbiddenException(
                'You are not the owner of this listing',
            );
        }

        if (listing.status === ListingStatus.DELETED_BY_USER) {
            return listing; // idempotent
        }

        return this.prisma.listing.update({
            where: { id: listingId },
            data: {
                status: ListingStatus.DELETED_BY_USER,
                deleteReason: dto.deleteReason,
                deletedAt: new Date(),
            },
        });
    }

    // =========================
    // Admin Approve
    // =========================
    async approve(listingId: string, role: UserRole) {
        if (role !== UserRole.ADMIN) {
            throw new ForbiddenException('Admin access only');
        }

        const listing = await this.prisma.listing.findUnique({
            where: { id: listingId },
        });

        if (!listing) {
            throw new NotFoundException('Listing not found');
        }

        if (listing.status !== ListingStatus.PENDING) {
            throw new ForbiddenException(
                'Only pending listings can be approved',
            );
        }

        return this.prisma.listing.update({
            where: { id: listingId },
            data: {
                status: ListingStatus.APPROVED,
                approvedAt: new Date(),
            },
        });
    }

    // =========================
    // Admin Reject
    // =========================
    async reject(
        listingId: string,
        role: UserRole,
        reason: string,
    ) {
        if (role !== UserRole.ADMIN) {
            throw new ForbiddenException('Admin access only');
        }

        return this.prisma.$transaction(async (tx) => {
            const listing = await tx.listing.findUnique({
                where: { id: listingId },
            });

            if (!listing) {
                throw new NotFoundException('Listing not found');
            }

            if (listing.status !== ListingStatus.PENDING) {
                throw new ForbiddenException(
                    'Only pending listings can be rejected',
                );
            }

            const updated = await tx.listing.update({
                where: { id: listingId },
                data: {
                    status: ListingStatus.REJECTED,
                    rejectionReason: reason,
                    rejectedAt: new Date(),
                },
            });

            // 🔁 بازگشت سهمیه (اتمیک)
            await this.quotaService.releaseOnReject(tx, listingId);

            return updated;
        });
    }

}
