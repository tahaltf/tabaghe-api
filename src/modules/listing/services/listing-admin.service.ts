import { Injectable } from '@nestjs/common';
import { Listing, ListingStatus, Prisma } from '@prisma/client';
import { PrismaService } from '../../../infrastructure/prisma/prisma.service';
import { QuotaService } from '../../quota/quota.service';
import { RejectListingDto } from '../dto/reject-listing.dto';

const ADMIN_LISTING_INCLUDE = {
  direct: true,
  auction: true,
  exchange: true,
  province: { select: { id: true, name: true } },
  city: { select: { id: true, name: true } },
  category: { select: { id: true, title: true } },
  author: {
    select: {
      id: true,
      phone: true,
      firstName: true,
      lastName: true,
      avatar: true,
      isVerified: true,
    },
  },
} satisfies Prisma.ListingInclude;

export type AdminListing = Prisma.ListingGetPayload<{ include: typeof ADMIN_LISTING_INCLUDE }>;

@Injectable()
export class ListingAdminService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly quotaService: QuotaService,
  ) {}

  listAll(status?: ListingStatus): Promise<AdminListing[]> {
    return this.prisma.listing.findMany({
      where: status ? { status } : {},
      include: ADMIN_LISTING_INCLUDE,
      orderBy: { createdAt: 'desc' },
    });
  }

  approve(listingId: string): Promise<Listing> {
    return this.prisma.listing.update({
      where: { id: listingId },
      data: { status: ListingStatus.APPROVED, approvedAt: new Date() },
    });
  }

  reject(listingId: string, dto: RejectListingDto): Promise<Listing> {
    return this.prisma.$transaction(async (tx) => {
      const updated = await tx.listing.update({
        where: { id: listingId },
        data: {
          status: ListingStatus.REJECTED,
          rejectionReason: dto.rejectionReason,
          rejectedAt: new Date(),
        },
      });
      await this.quotaService.releaseOnReject(tx, listingId);
      return updated;
    });
  }
}
