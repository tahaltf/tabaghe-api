import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import {
  ExchangeOfferStatus,
  Listing,
  ListingStatus,
  NotificationType,
  Prisma,
} from '@prisma/client';
import { PrismaService } from '../../../infrastructure/prisma/prisma.service';
import { QuotaService } from '../../quota/quota.service';
import { RejectListingDto } from '../dto/reject-listing.dto';
import { AdminListingCorrectionsDto } from '../dto/admin-listing-corrections.dto';
import { NotificationService } from '../../notification/notification.service';
import { TRADE_REPUTATION_PENALTY_DELTA } from '../../orders/order-reputation.service';
import { ListingExpiryService } from './listing-expiry.service';

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
    private readonly listingExpiry: ListingExpiryService,
  ) {}

  listAll(status?: ListingStatus): Promise<AdminListing[]> {
    return this.prisma.listing.findMany({
      where: status ? { status } : {},
      include: ADMIN_LISTING_INCLUDE,
      orderBy: { createdAt: 'desc' },
    });
  }

  private hasCorrections(dto: AdminListingCorrectionsDto): boolean {
    return (
      dto.title !== undefined ||
      dto.description !== undefined ||
      dto.desiredTitle !== undefined ||
      dto.desiredDescription !== undefined
    );
  }

  async applyCorrections(
    listingId: string,
    dto: AdminListingCorrectionsDto,
  ): Promise<Listing> {
    if (!this.hasCorrections(dto)) {
      throw new BadRequestException('حداقل یک فیلد برای اصلاح ارسال کنید');
    }

    const listing = await this.prisma.listing.findUnique({
      where: { id: listingId },
      include: { exchange: true },
    });
    if (!listing) throw new NotFoundException('آگهی یافت نشد');
    if (listing.status !== ListingStatus.PENDING) {
      throw new BadRequestException(
        'فقط آگهی‌های در انتظار تایید توسط ادمین قابل ویرایش هستند',
      );
    }

    const listingData: Prisma.ListingUpdateInput = {};
    if (dto.title !== undefined) {
      const title = dto.title.trim();
      if (title.length < 2) {
        throw new BadRequestException('عنوان آگهی باید حداقل ۲ کاراکتر باشد');
      }
      listingData.title = title;
    }
    if (dto.description !== undefined) {
      listingData.description = dto.description.trim() || null;
    }

    const exchangeData: Prisma.ListingExchangeUpdateInput = {};
    if (dto.desiredTitle !== undefined) {
      exchangeData.desiredTitle = dto.desiredTitle.trim();
    }
    if (dto.desiredDescription !== undefined) {
      exchangeData.desiredDescription =
        dto.desiredDescription.trim() || null;
    }
    const patchExchange = Object.keys(exchangeData).length > 0;

    if (patchExchange && !listing.exchange) {
      throw new BadRequestException(
        'این آگهی فیلد کالای درخواستی معاوضه ندارد',
      );
    }

    return this.prisma.$transaction(async (tx) => {
      if (patchExchange) {
        await tx.listingExchange.update({
          where: { listingId },
          data: exchangeData,
        });
      }
      return tx.listing.update({
        where: { id: listingId },
        data: listingData,
        include: ADMIN_LISTING_INCLUDE,
      });
    });
  }

  async approve(
    listingId: string,
    dto?: AdminListingCorrectionsDto,
  ): Promise<Listing> {
    if (dto && this.hasCorrections(dto)) {
      await this.applyCorrections(listingId, dto);
    }

    const approvedAt = new Date();
    const expiryFields = await this.listingExpiry.approvalExpiryFields(approvedAt);
    const updated = await this.prisma.listing.update({
      where: { id: listingId },
      data: {
        status: ListingStatus.APPROVED,
        approvedAt,
        ...expiryFields,
      },
    });

    await this.notificationService.create({
      userId: updated.authorId,
      type: NotificationType.LISTING_APPROVED,
      title: 'آگهی شما تایید شد',
      message: `آگهی «${updated.title}» توسط ادمین تایید و منتشر شد.`,
      meta: { listingId: updated.id, listingType: updated.type },
    });

    return updated;
  }

  reject(listingId: string, dto: RejectListingDto): Promise<Listing> {
    return this.prisma.$transaction(async (tx) => {
      const cycleStartedAt = new Date();
      const updated = await tx.listing.update({
        where: { id: listingId },
        data: {
          status: ListingStatus.REJECTED,
          rejectionReason: dto.rejectionReason,
          rejectedAt: cycleStartedAt,
          exchangeOffersSince: cycleStartedAt,
        },
      });
      await tx.exchangeOffer.updateMany({
        where: { listingId },
        data: { status: ExchangeOfferStatus.REJECTED },
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
        meta: { listingId: updated.id, listingType: updated.type, reason: dto.rejectionReason },
      });

      return updated;
    });
  }

  async setStatus(listingId: string, status: ListingStatus): Promise<Listing> {
    const before = await this.prisma.listing.findUnique({
      where: { id: listingId },
      select: { id: true, status: true, title: true, authorId: true, type: true },
    });
    if (!before) throw new NotFoundException('آگهی یافت نشد');

    const data: Prisma.ListingUpdateInput = {
      status,
    };
    if (status === ListingStatus.APPROVED) {
      const approvedAt = new Date();
      const expiryFields = await this.listingExpiry.approvalExpiryFields(approvedAt);
      data.approvedAt = approvedAt;
      data.expiresAt = expiryFields.expiresAt as Date;
      data.expiryReminderSentAt = null;
    }
    const updated = await this.prisma.listing.update({
      where: { id: listingId },
      data,
    });

    if (
      status === ListingStatus.APPROVED &&
      before.status !== ListingStatus.APPROVED
    ) {
      await this.notificationService.create({
        userId: before.authorId,
        type: NotificationType.LISTING_APPROVED,
        title: 'آگهی شما تایید شد',
        message: `آگهی «${before.title}» توسط ادمین تایید و منتشر شد.`,
        meta: { listingId: updated.id, listingType: before.type },
      });
    }

    return updated;
  }
}
