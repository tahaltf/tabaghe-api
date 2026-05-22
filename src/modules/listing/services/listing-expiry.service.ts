import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import {
  AuctionStatus,
  ListingStatus,
  ListingType,
  NotificationType,
  Prisma,
} from '@prisma/client';
import { PrismaService } from '../../../infrastructure/prisma/prisma.service';
import { NotificationService } from '../../notification/notification.service';

export const LISTING_DISPLAY_DAYS_SETTING_KEY = 'LISTING_DISPLAY_DAYS';

@Injectable()
export class ListingExpiryService {
  private readonly logger = new Logger(ListingExpiryService.name);
  static readonly DEFAULT_DISPLAY_DAYS = 7;
  private static readonly REMINDER_LEAD_MS = 24 * 60 * 60 * 1000;

  constructor(
    private readonly prisma: PrismaService,
    private readonly notificationService: NotificationService,
  ) {}

  async getDisplayDays(): Promise<number> {
    const row = await this.prisma.systemSetting.findUnique({
      where: { key: LISTING_DISPLAY_DAYS_SETTING_KEY },
      select: { value: true },
    });
    const parsed = Number(row?.value ?? '');
    if (Number.isFinite(parsed) && parsed >= 1) {
      return Math.min(365, Math.floor(parsed));
    }
    return ListingExpiryService.DEFAULT_DISPLAY_DAYS;
  }

  computeExpiresAt(approvedAt: Date, displayDays: number): Date {
    const ms = displayDays * 24 * 60 * 60 * 1000;
    return new Date(approvedAt.getTime() + ms);
  }

  async approvalExpiryFields(
    approvedAt: Date = new Date(),
  ): Promise<Pick<Prisma.ListingUpdateInput, 'expiresAt' | 'expiryReminderSentAt'>> {
    const days = await this.getDisplayDays();
    return {
      expiresAt: this.computeExpiresAt(approvedAt, days),
      expiryReminderSentAt: null,
    };
  }

  /** پس از تایید ادمین — تنظیم مهلت نمایش از زمان انتشار */
  async applyOnApproval(listingId: string, approvedAt: Date = new Date()) {
    const fields = await this.approvalExpiryFields(approvedAt);
    return this.prisma.listing.update({
      where: { id: listingId },
      data: {
        approvedAt,
        ...fields,
      },
    });
  }

  private isActiveAuctionListing(
    listing: Prisma.ListingGetPayload<{ include: { auction: true } }>,
  ): boolean {
    return (
      listing.type === ListingType.AUCTION &&
      listing.auction?.status === AuctionStatus.ACTIVE &&
      listing.auction.endDatetime.getTime() > Date.now()
    );
  }

  @Cron(CronExpression.EVERY_MINUTE)
  async runListingExpiryJob(): Promise<void> {
    try {
      await this.backfillMissingExpiresAt();
      await this.sendExpiryReminders();
      await this.archiveExpiredListings();
    } catch (err) {
      this.logger.error(
        'Listing expiry job failed',
        err instanceof Error ? err.stack : undefined,
      );
    }
  }

  private async backfillMissingExpiresAt(): Promise<void> {
    const days = await this.getDisplayDays();
    const listings = await this.prisma.listing.findMany({
      where: {
        status: ListingStatus.APPROVED,
        approvedAt: { not: null },
        expiresAt: null,
      },
      select: { id: true, approvedAt: true },
    });
    if (!listings.length) return;

    await this.prisma.$transaction(
      listings.map((l) =>
        this.prisma.listing.update({
          where: { id: l.id },
          data: {
            expiresAt: this.computeExpiresAt(l.approvedAt!, days),
          },
        }),
      ),
    );
  }

  private async sendExpiryReminders(): Promise<void> {
    const now = Date.now();
    const windowEnd = new Date(now + ListingExpiryService.REMINDER_LEAD_MS);

    const candidates = await this.prisma.listing.findMany({
      where: {
        status: ListingStatus.APPROVED,
        expiryReminderSentAt: null,
        expiresAt: { gt: new Date(now), lte: windowEnd },
      },
      include: { auction: true },
    });

    for (const listing of candidates) {
      if (this.isActiveAuctionListing(listing)) continue;

      const expiresFa = listing.expiresAt!.toLocaleString('fa-IR', {
        dateStyle: 'short',
        timeZone: 'Asia/Tehran',
      });

      await this.notificationService.create({
        userId: listing.authorId,
        type: NotificationType.LISTING_EXPIRY_REMINDER,
        title: 'پایان نمایش آگهی فردا',
        message:
          `فردا آگهی «${listing.title}» به‌دلیل پایان مدت نمایش از سایت حذف می‌شود. ` +
          `اگر کالا هنوز فروخته نشده و مایل به نمایش روی سایت هستید، آگهی خود را ویرایش کنید تا پس از تایید ادمین مجدداً روی سایت قرار گیرد. ` +
          `(پایان نمایش: ${expiresFa})`,
        meta: {
          listingId: listing.id,
          expiresAt: listing.expiresAt!.toISOString(),
        },
      });

      await this.prisma.listing.update({
        where: { id: listing.id },
        data: { expiryReminderSentAt: new Date() },
      });
    }
  }

  private async archiveExpiredListings(): Promise<void> {
    const now = new Date();
    const expired = await this.prisma.listing.findMany({
      where: {
        status: ListingStatus.APPROVED,
        expiresAt: { lte: now },
      },
      include: { auction: true },
    });

    for (const listing of expired) {
      if (this.isActiveAuctionListing(listing)) continue;

      await this.prisma.listing.update({
        where: { id: listing.id },
        data: { status: ListingStatus.ARCHIVED },
      });

      await this.notificationService.create({
        userId: listing.authorId,
        type: NotificationType.LISTING_EXPIRED,
        title: 'آگهی از سایت برداشته شد',
        message:
          `آگهی «${listing.title}» به‌دلیل پایان مدت نمایش از سایت برداشته شد. ` +
          `اگر کالا هنوز فروخته نشده و مایل به نمایش مجدد هستید، آگهی خود را ویرایش کنید تا پس از تایید ادمین دوباره روی سایت قرار گیرد.`,
        meta: { listingId: listing.id },
      });
    }
  }
}
