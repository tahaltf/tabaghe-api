import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import {
  AuctionStatus,
  ListingStatus,
  ListingType,
  Prisma,
} from '@prisma/client';
import { PrismaService } from '../../../infrastructure/prisma/prisma.service';
import { ListingNotificationBatchService } from '../../../common/notification/listing-notification-batch.service';

export const LISTING_DISPLAY_DAYS_SETTING_KEY = 'LISTING_DISPLAY_DAYS';

@Injectable()
export class ListingExpiryService {
  private readonly logger = new Logger(ListingExpiryService.name);
  static readonly DEFAULT_DISPLAY_DAYS = 7;
  private static readonly REMINDER_LEAD_MS = 24 * 60 * 60 * 1000;

  constructor(
    private readonly prisma: PrismaService,
    private readonly listingNotificationBatch: ListingNotificationBatchService,
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

  /** آگهی‌های تاییدشده: expiresAt = approvedAt + مدت فعلی نمایش (برای آگهی‌های قدیمی پس از تغییر تنظیم) */
  async recalculateApprovedListingExpiry(): Promise<{ updated: number }> {
    const days = await this.getDisplayDays();
    const reminderWindowEnd = Date.now() + ListingExpiryService.REMINDER_LEAD_MS;

    const listings = await this.prisma.listing.findMany({
      where: {
        status: ListingStatus.APPROVED,
        approvedAt: { not: null },
      },
      select: { id: true, approvedAt: true, expiresAt: true },
    });

    const updates: Prisma.PrismaPromise<unknown>[] = [];
    for (const listing of listings) {
      const newExpiresAt = this.computeExpiresAt(listing.approvedAt!, days);
      if (listing.expiresAt?.getTime() === newExpiresAt.getTime()) continue;

      const data: Prisma.ListingUpdateInput = { expiresAt: newExpiresAt };
      if (newExpiresAt.getTime() > reminderWindowEnd) {
        data.expiryReminderSentAt = null;
      }

      updates.push(
        this.prisma.listing.update({
          where: { id: listing.id },
          data,
        }),
      );
    }

    if (updates.length) {
      await this.prisma.$transaction(updates);
      this.logger.log(
        `Recalculated listing expiry for ${updates.length} approved listing(s) (${days} days)`,
      );
    }

    return { updated: updates.length };
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

    const reminderItems: Array<{
      listingId: string;
      listingTitle: string;
      authorId: string;
      expiresAt: string;
    }> = [];

    for (const listing of candidates) {
      if (this.isActiveAuctionListing(listing)) continue;

      reminderItems.push({
        listingId: listing.id,
        listingTitle: listing.title,
        authorId: listing.authorId,
        expiresAt: listing.expiresAt!.toISOString(),
      });
    }

    if (!reminderItems.length) return;

    await this.prisma.$transaction(
      reminderItems.map((item) =>
        this.prisma.listing.update({
          where: { id: item.listingId },
          data: { expiryReminderSentAt: new Date() },
        }),
      ),
    );

    await this.listingNotificationBatch.flushUserListingExpiryReminderAlerts(
      reminderItems,
    );
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

    const expiredItems: Array<{
      listingId: string;
      listingTitle: string;
      authorId: string;
    }> = [];

    for (const listing of expired) {
      if (this.isActiveAuctionListing(listing)) continue;

      expiredItems.push({
        listingId: listing.id,
        listingTitle: listing.title,
        authorId: listing.authorId,
      });
    }

    if (!expiredItems.length) return;

    await this.prisma.$transaction(
      expiredItems.map((item) =>
        this.prisma.listing.update({
          where: { id: item.listingId },
          data: { status: ListingStatus.ARCHIVED },
        }),
      ),
    );

    await this.listingNotificationBatch.flushUserListingExpiredAlerts(
      expiredItems,
    );
  }
}
