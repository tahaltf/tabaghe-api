import { Injectable } from '@nestjs/common';
import {
  ListingImportSource,
  ListingType,
  NotificationType,
} from '@prisma/client';
import { NotificationService } from '../../modules/notification/notification.service';
import { listingTypePersianLabel } from '../system-settings/listing-type-enabled';
import { TRADE_REPUTATION_PENALTY_DELTA } from '../../modules/orders/order-reputation.service';

export const LISTING_NOTIFICATION_BATCH_THRESHOLD = 3;

export type ListingAlertItem = {
  listingId: string;
  listingTitle: string;
  listingType: ListingType;
  userId: string;
  importSource?: ListingImportSource | string;
  resubmittedAfterReject?: boolean;
  adminNotificationMessage?: string;
  adminNotificationTitle?: string;
};

@Injectable()
export class ListingNotificationBatchService {
  constructor(private readonly notifications: NotificationService) {}

  async flushAdminNewListingAlerts(items: ListingAlertItem[]): Promise<void> {
    if (!items.length) return;

    if (items.length <= LISTING_NOTIFICATION_BATCH_THRESHOLD) {
      for (const item of items) {
        const wasRejected = item.resubmittedAfterReject === true;
        await this.notifications.notifyAdminPersonnel({
          type: NotificationType.ADMIN_ALERT_NEW_LISTING,
          title:
            item.adminNotificationTitle ??
            (wasRejected
              ? 'آگهی اصلاح‌شده در انتظار تایید'
              : 'آگهی جدید در انتظار تایید'),
          message:
            item.adminNotificationMessage ??
            (wasRejected
              ? `آگهی «${item.listingTitle}» (${listingTypePersianLabel(item.listingType)}) پس از رد/اصلاح توسط فروشنده دوباره برای بررسی ارسال شد.`
              : `آگهی «${item.listingTitle}» (${listingTypePersianLabel(item.listingType)}) ثبت شد و در انتظار بررسی است.`),
          meta: {
            listingId: item.listingId,
            userId: item.userId,
            listingTitle: item.listingTitle,
            listingType: item.listingType,
            ...(item.importSource ? { importSource: item.importSource } : {}),
            ...(wasRejected ? { resubmittedAfterReject: true } : {}),
          },
        });
      }
      return;
    }

    const byUser = groupByUserId(items);
    for (const [userId, group] of byUser) {
      const count = group.length;
      await this.notifications.notifyAdminPersonnel({
        type: NotificationType.ADMIN_ALERT_NEW_LISTING,
        title: `${count} آگهی جدید در انتظار تایید`,
        message: `${count} آگهی جدید در انتظار تایید — کاربر {{userName}} ({{userPhone}})`,
        meta: {
          isBatch: true,
          batchCount: count,
          userId,
          listingIds: group.map((g) => g.listingId),
          importSource: group[0]?.importSource,
        },
      });
    }
  }

  async flushUserListingApprovedAlerts(
    items: Array<{
      listingId: string;
      listingTitle: string;
      listingType: ListingType;
      authorId: string;
    }>,
  ): Promise<void> {
    if (!items.length) return;

    const byAuthor = groupByAuthorId(items);
    for (const [authorId, group] of byAuthor) {
      if (group.length <= LISTING_NOTIFICATION_BATCH_THRESHOLD) {
        for (const item of group) {
          await this.notifications.create({
            userId: authorId,
            type: NotificationType.LISTING_APPROVED,
            title: 'آگهی شما تایید شد',
            message: `آگهی «${item.listingTitle}» توسط ادمین تایید و منتشر شد.`,
            meta: {
              listingId: item.listingId,
              listingType: item.listingType,
              listingTitle: item.listingTitle,
            },
          });
        }
        continue;
      }

      await this.notifications.create({
        userId: authorId,
        type: NotificationType.LISTING_APPROVED,
        title: 'آگهی‌های شما تایید شد',
        message: `${group.length} آگهی شما توسط ادمین تایید و منتشر شد.`,
        meta: {
          isBatch: true,
          batchCount: group.length,
          listingIds: group.map((g) => g.listingId),
        },
      });
    }
  }

  async flushUserListingRejectedAlerts(
    items: Array<{
      listingId: string;
      listingTitle: string;
      listingType: ListingType;
      authorId: string;
    }>,
    rejectionReason: string,
  ): Promise<void> {
    if (!items.length) return;

    const byAuthor = groupByAuthorId(items);
    for (const [authorId, group] of byAuthor) {
      if (group.length <= LISTING_NOTIFICATION_BATCH_THRESHOLD) {
        for (const item of group) {
          await this.notifications.create({
            userId: authorId,
            type: NotificationType.LISTING_REJECTED,
            title: 'آگهی شما رد شد',
            message: `آگهی «${item.listingTitle}» رد شد. دلیل رد: ${rejectionReason}. طبق قوانین طبقه، ${TRADE_REPUTATION_PENALTY_DELTA} واحد از امتیاز اعتماد شما کسر شد.`,
            meta: {
              listingId: item.listingId,
              listingType: item.listingType,
              listingTitle: item.listingTitle,
              reason: rejectionReason,
            },
          });
        }
        continue;
      }

      await this.notifications.create({
        userId: authorId,
        type: NotificationType.LISTING_REJECTED,
        title: 'آگهی‌های شما رد شد',
        message: `${group.length} آگهی شما رد شد. دلیل رد: ${rejectionReason}. طبق قوانین طبقه، ${TRADE_REPUTATION_PENALTY_DELTA} واحد از امتیاز اعتماد شما به ازای هر آگهی کسر شد.`,
        meta: {
          isBatch: true,
          batchCount: group.length,
          listingIds: group.map((g) => g.listingId),
          reason: rejectionReason,
        },
      });
    }
  }

  async flushUserListingExpiryReminderAlerts(
    items: Array<{
      listingId: string;
      listingTitle: string;
      authorId: string;
      expiresAt: string;
    }>,
  ): Promise<void> {
    if (!items.length) return;

    const byAuthor = groupByAuthorId(items);
    for (const [authorId, group] of byAuthor) {
      if (group.length <= LISTING_NOTIFICATION_BATCH_THRESHOLD) {
        for (const item of group) {
          const expiresFa = new Date(item.expiresAt).toLocaleString('fa-IR', {
            dateStyle: 'short',
            timeZone: 'Asia/Tehran',
          });
          await this.notifications.create({
            userId: authorId,
            type: NotificationType.LISTING_EXPIRY_REMINDER,
            title: 'پایان نمایش آگهی فردا',
            message:
              `فردا آگهی «${item.listingTitle}» به‌دلیل پایان مدت نمایش از سایت حذف می‌شود. ` +
              `اگر کالا هنوز فروخته نشده و مایل به نمایش روی سایت هستید، آگهی خود را ویرایش کنید تا پس از تایید ادمین مجدداً روی سایت قرار گیرد. ` +
              `(پایان نمایش: ${expiresFa})`,
            meta: {
              listingId: item.listingId,
              listingTitle: item.listingTitle,
              expiresAt: item.expiresAt,
            },
          });
        }
        continue;
      }

      await this.notifications.create({
        userId: authorId,
        type: NotificationType.LISTING_EXPIRY_REMINDER,
        title: 'پایان نمایش آگهی‌های شما فردا',
        message:
          `${group.length} آگهی شما فردا به‌دلیل پایان مدت نمایش از سایت حذف می‌شود. ` +
          `اگر کالا هنوز فروخته نشده و مایل به نمایش روی سایت هستید، آگهی‌های خود را ویرایش کنید تا پس از تایید ادمین مجدداً روی سایت قرار گیرند.`,
        meta: {
          isBatch: true,
          batchCount: group.length,
          listingIds: group.map((g) => g.listingId),
        },
      });
    }
  }

  async flushUserListingExpiredAlerts(
    items: Array<{
      listingId: string;
      listingTitle: string;
      authorId: string;
    }>,
  ): Promise<void> {
    if (!items.length) return;

    const byAuthor = groupByAuthorId(items);
    for (const [authorId, group] of byAuthor) {
      if (group.length <= LISTING_NOTIFICATION_BATCH_THRESHOLD) {
        for (const item of group) {
          await this.notifications.create({
            userId: authorId,
            type: NotificationType.LISTING_EXPIRED,
            title: 'آگهی از سایت برداشته شد',
            message:
              `آگهی «${item.listingTitle}» به‌دلیل پایان مدت نمایش از سایت برداشته شد. ` +
              `اگر کالا هنوز فروخته نشده و مایل به نمایش مجدد هستید، آگهی خود را ویرایش کنید تا پس از تایید ادمین دوباره روی سایت قرار گیرد.`,
            meta: {
              listingId: item.listingId,
              listingTitle: item.listingTitle,
            },
          });
        }
        continue;
      }

      await this.notifications.create({
        userId: authorId,
        type: NotificationType.LISTING_EXPIRED,
        title: 'آگهی‌های شما از سایت برداشته شد',
        message:
          `${group.length} آگهی شما به‌دلیل پایان مدت نمایش از سایت برداشته شد. ` +
          `اگر کالا هنوز فروخته نشده و مایل به نمایش مجدد هستید، آگهی‌های خود را ویرایش کنید تا پس از تایید ادمین دوباره روی سایت قرار گیرند.`,
        meta: {
          isBatch: true,
          batchCount: group.length,
          listingIds: group.map((g) => g.listingId),
        },
      });
    }
  }
}

function groupByUserId(
  items: ListingAlertItem[],
): Map<string, ListingAlertItem[]> {
  const map = new Map<string, ListingAlertItem[]>();
  for (const item of items) {
    const list = map.get(item.userId) ?? [];
    list.push(item);
    map.set(item.userId, list);
  }
  return map;
}

function groupByAuthorId<T extends { authorId: string }>(
  items: T[],
): Map<string, T[]> {
  const map = new Map<string, T[]>();
  for (const item of items) {
    const list = map.get(item.authorId) ?? [];
    list.push(item);
    map.set(item.authorId, list);
  }
  return map;
}
