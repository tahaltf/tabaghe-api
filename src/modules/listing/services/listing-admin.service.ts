import { Injectable } from '@nestjs/common';
import {
  Listing,
  ListingStatus,
  NotificationType,
  Prisma,
} from '@prisma/client';
import { PrismaService } from '../../../infrastructure/prisma/prisma.service';
import { QuotaService } from '../../quota/quota.service';
import { RejectListingDto } from '../dto/reject-listing.dto';
import { NotificationService } from '../../notification/notification.service';
import { TRADE_REPUTATION_PENALTY_DELTA } from '../../orders/order-reputation.service';

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

export type AdminListing = Prisma.ListingGetPayload<{
  include: typeof ADMIN_LISTING_INCLUDE;
}>;

@Injectable()
export class ListingAdminService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly quotaService: QuotaService,
    private readonly notificationService: NotificationService,
  ) {}

  listAll(status?: ListingStatus): Promise<AdminListing[]> {
    return this.prisma.listing.findMany({
      where: status ? { status } : {},
      include: ADMIN_LISTING_INCLUDE,
      orderBy: { createdAt: 'desc' },
    });
  }

  async approve(listingId: string): Promise<Listing> {
    const updated = await this.prisma.listing.update({
      where: { id: listingId },
      data: { status: ListingStatus.APPROVED, approvedAt: new Date() },
    });

    await this.notificationService.create({
      userId: updated.authorId,
      type: NotificationType.LISTING_APPROVED,
      title: 'آگهی شما تایید شد',
      message: `آگهی «${updated.title}» توسط ادمین تایید و منتشر شد.`,
      meta: { listingId: updated.id },
    });

    return updated;
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

      const author = await tx.user.findUnique({
        where: { id: updated.authorId },
        select: { rating: true },
      });
      if (author) {
        const current = Number(author.rating ?? 5);
        const next = Math.max(0, current - TRADE_REPUTATION_PENALTY_DELTA);
        await tx.user.update({
          where: { id: updated.authorId },
          data: { rating: next },
        });
      }

      await this.notificationService.create({
        userId: updated.authorId,
        type: NotificationType.LISTING_REJECTED,
        title: 'آگهی شما رد شد',
        message: `آگهی «${updated.title}» رد شد. دلیل رد: ${dto.rejectionReason}. طبق قوانین طبقه، ${TRADE_REPUTATION_PENALTY_DELTA} واحد از امتیاز اعتماد شما کسر شد.`,
        meta: { listingId: updated.id, reason: dto.rejectionReason },
      });

      return updated;
    });
  }

  async setStatus(listingId: string, status: ListingStatus): Promise<Listing> {
    const data: Prisma.ListingUpdateInput = {
      status,
    };
    if (status === ListingStatus.APPROVED) {
      data.approvedAt = new Date();
    }
    return this.prisma.listing.update({
      where: { id: listingId },
      data,
    });
  }
}
