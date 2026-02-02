import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { SearchListingsDto } from './dto/search-listings.dto';

@Injectable()
export class ListingSearchService {
    constructor(private readonly prisma: PrismaService) {}

    async search(dto: SearchListingsDto) {
        const {
            type,
            status,
            province,
            city,
            auctionStatus,
            priceMin,
            priceMax,
            page,
            limit,
        } = dto;

        const skip = (page - 1) * limit;

        const where: any = {
            ...(type && { type }),
            ...(status && { status }),
            ...(province && { province }),
            ...(city && { city }),
        };

        // Auction filters
        if (auctionStatus) {
            where.auction = {
                status: auctionStatus,
            };
        }

        // Price filters
        if (priceMin !== undefined || priceMax !== undefined) {
            where.OR = [
                {
                    direct: {
                        price: {
                            ...(priceMin !== undefined && { gte: priceMin }),
                            ...(priceMax !== undefined && { lte: priceMax }),
                        },
                    },
                },
                {
                    auction: {
                        highestBidAmount: {
                            ...(priceMin !== undefined && { gte: priceMin }),
                            ...(priceMax !== undefined && { lte: priceMax }),
                        },
                    },
                },
            ];
        }

        const [items, total] = await this.prisma.$transaction([
            this.prisma.listing.findMany({
                where,
                skip,
                take: limit,
                orderBy: {
                    createdAt: 'desc',
                },
                include: {
                    direct: true,
                    auction: true,
                },
            }),
            this.prisma.listing.count({ where }),
        ]);

        return {
            page,
            limit,
            total,
            totalPages: Math.ceil(total / limit),
            items,
        };
    }
}
