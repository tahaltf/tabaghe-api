import { Injectable, BadRequestException } from '@nestjs/common';
import {
  OrderStatus,
  WalletTransactionType,
  WalletTransactionStatus,
} from '@prisma/client';
import { PrismaService } from '../../../infrastructure/prisma/prisma.service';

export type AdminBadgeResource =
  | 'users'
  | 'listings'
  | 'orders'
  | 'walletRequests'
  | 'tickets'
  | 'complaints'
  | 'repairs'
  | 'productRequests'
  | 'contactMessages';

const ALL_RESOURCES: AdminBadgeResource[] = [
  'users',
  'listings',
  'orders',
  'walletRequests',
  'tickets',
  'complaints',
  'repairs',
  'productRequests',
  'contactMessages',
];

const EPOCH = new Date(0);

function lastSeenKey(
  adminUserId: string,
  resource: AdminBadgeResource,
): string {
  return `ADMIN_BADGE_LAST_SEEN_${adminUserId}_${resource}`;
}

@Injectable()
export class AdminBadgesService {
  constructor(private readonly prisma: PrismaService) {}

  isValidResource(value: string): value is AdminBadgeResource {
    return (ALL_RESOURCES as string[]).includes(value);
  }

  /**
   * Retrieves the per-resource lastSeenAt timestamps along with the count of items
   * newer than that timestamp (i.e. unseen by the admin since their last visit).
   */
  async getBadges(adminUserId: string) {
    const lastSeenMap = await this.loadLastSeenMap(adminUserId);

    const counts: Record<AdminBadgeResource, number> = {
      users: 0,
      listings: 0,
      orders: 0,
      walletRequests: 0,
      tickets: 0,
      complaints: 0,
      repairs: 0,
      productRequests: 0,
      contactMessages: 0,
    };

    const ops = ALL_RESOURCES.map(async (resource) => {
      const since = lastSeenMap[resource] ?? EPOCH;
      counts[resource] = await this.countNewerThan(resource, since);
    });

    await Promise.all(ops);

    return {
      counts,
      lastSeenAt: Object.fromEntries(
        ALL_RESOURCES.map((r) => [r, (lastSeenMap[r] ?? EPOCH).toISOString()]),
      ) as Record<AdminBadgeResource, string>,
    };
  }

  /**
   * Marks a resource (or all resources) as seen for the admin by setting
   * lastSeenAt to NOW. Returns the new timestamp.
   */
  async markSeen(
    adminUserId: string,
    resource: string | undefined,
  ): Promise<{
    resource: AdminBadgeResource | 'all';
    lastSeenAt: string;
  }> {
    const now = new Date();
    if (!resource || resource === 'all') {
      await Promise.all(
        ALL_RESOURCES.map((r) => this.upsertLastSeen(adminUserId, r, now)),
      );
      return { resource: 'all', lastSeenAt: now.toISOString() };
    }
    if (!this.isValidResource(resource)) {
      throw new BadRequestException('نوع منبع نامعتبر است');
    }
    await this.upsertLastSeen(adminUserId, resource, now);
    return { resource, lastSeenAt: now.toISOString() };
  }

  private async loadLastSeenMap(adminUserId: string) {
    const rows = await this.prisma.systemSetting.findMany({
      where: {
        key: { in: ALL_RESOURCES.map((r) => lastSeenKey(adminUserId, r)) },
      },
      select: { key: true, value: true },
    });

    const map: Partial<Record<AdminBadgeResource, Date>> = {};
    for (const row of rows) {
      const resource = ALL_RESOURCES.find(
        (r) => row.key === lastSeenKey(adminUserId, r),
      );
      if (!resource) continue;
      const date = new Date(row.value || '');
      if (!Number.isNaN(date.getTime())) {
        map[resource] = date;
      }
    }
    return map;
  }

  private async upsertLastSeen(
    adminUserId: string,
    resource: AdminBadgeResource,
    when: Date,
  ): Promise<void> {
    const key = lastSeenKey(adminUserId, resource);
    const value = when.toISOString();
    await this.prisma.systemSetting.upsert({
      where: { key },
      update: { value },
      create: {
        key,
        value,
        description: `Admin badge lastSeenAt for ${resource}`,
      },
    });
  }

  private async countNewerThan(
    resource: AdminBadgeResource,
    since: Date,
  ): Promise<number> {
    try {
      switch (resource) {
        case 'users':
          return this.prisma.user.count({
            where: { createdAt: { gt: since } },
          });

        case 'listings':
          return this.prisma.listing.count({
            where: { createdAt: { gt: since } },
          });

        case 'orders':
          return this.prisma.order.count({
            where: { createdAt: { gt: since } },
          });

        case 'walletRequests':
          return this.prisma.walletTransaction.count({
            where: {
              createdAt: { gt: since },
              status: WalletTransactionStatus.PENDING,
              type: {
                in: [
                  WalletTransactionType.DEPOSIT,
                  WalletTransactionType.WITHDRAW_REQUEST,
                ],
              },
            },
          });

        case 'tickets':
          return this.prisma.ticket.count({
            where: { createdAt: { gt: since } },
          });

        case 'complaints':
          return this.prisma.order.count({
            where: {
              status: OrderStatus.DISPUTED,
              updatedAt: { gt: since },
            },
          });

        case 'repairs':
          return this.prisma.repairRequest.count({
            where: { createdAt: { gt: since } },
          });

        case 'productRequests':
          return this.prisma.productRequest.count({
            where: { createdAt: { gt: since } },
          });

        case 'contactMessages':
          return this.countUnreadContactMessages();

        default:
          return 0;
      }
    } catch {
      return 0;
    }
  }

  private async countUnreadContactMessages(): Promise<number> {
    const rows = await this.prisma.systemSetting.findMany({
      where: { key: { startsWith: 'CONTACT_MESSAGE_' } },
      select: { value: true },
    });
    let unread = 0;
    for (const row of rows) {
      try {
        const parsed = JSON.parse(row.value || '{}');
        if (parsed && parsed.isRead !== true) unread += 1;
      } catch {
        unread += 1;
      }
    }
    return unread;
  }
}
