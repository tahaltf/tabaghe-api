import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';

const VIEW_DEDUP_MS = 30 * 60 * 1000;

@Injectable()
export class ListingAnalyticsService {
  constructor(private readonly prisma: PrismaService) {}

  async recordView(
    listingId: string,
    userId?: string,
    sessionId?: string,
  ): Promise<void> {
    const since = new Date(Date.now() - VIEW_DEDUP_MS);
    const existing = await this.prisma.listingView.findFirst({
      where: {
        listingId,
        viewedAt: { gte: since },
        ...(userId ? { userId } : { sessionId: sessionId ?? undefined }),
      },
      select: { id: true },
    });
    if (existing) return;

    await this.prisma.listingView.create({
      data: {
        listingId,
        userId: userId ?? null,
        sessionId: userId ? null : sessionId ?? null,
      },
    });
  }

  async listListingStats() {
    const views = await this.prisma.listingView.groupBy({
      by: ['listingId'],
      _count: { _all: true },
      _max: { viewedAt: true },
    });
    const listingIds = views.map((v) => v.listingId);
    const listings = await this.prisma.listing.findMany({
      where: { id: { in: listingIds } },
      select: {
        id: true,
        title: true,
        thumbnail: true,
        status: true,
        author: { select: { id: true, firstName: true, lastName: true } },
      },
    });
    const listingMap = new Map(listings.map((l) => [l.id, l]));

    const uniqueCounts = await Promise.all(
      listingIds.map(async (listingId) => {
        const users = await this.prisma.listingView.findMany({
          where: { listingId, userId: { not: null } },
          distinct: ['userId'],
          select: { userId: true },
        });
        const sessions = await this.prisma.listingView.findMany({
          where: { listingId, userId: null, sessionId: { not: null } },
          distinct: ['sessionId'],
          select: { sessionId: true },
        });
        return {
          listingId,
          uniqueViewers: users.length + sessions.length,
        };
      }),
    );
    const uniqueMap = new Map(
      uniqueCounts.map((u) => [u.listingId, u.uniqueViewers]),
    );

    return views
      .map((v) => ({
        listingId: v.listingId,
        listing: listingMap.get(v.listingId) ?? null,
        viewCount: v._count._all,
        uniqueViewers: uniqueMap.get(v.listingId) ?? 0,
        lastViewedAt: v._max.viewedAt,
      }))
      .sort((a, b) => b.viewCount - a.viewCount);
  }

  async listListingViewers(listingId: string, limit = 50) {
    return this.prisma.listingView.findMany({
      where: { listingId },
      orderBy: { viewedAt: 'desc' },
      take: limit,
      include: {
        user: {
          select: {
            id: true,
            firstName: true,
            lastName: true,
            phone: true,
          },
        },
      },
    });
  }

  async listUserRecentViews(userId: string, limit = 20) {
    return this.prisma.listingView.findMany({
      where: { userId },
      orderBy: { viewedAt: 'desc' },
      take: limit,
      include: {
        listing: {
          select: { id: true, title: true, thumbnail: true, type: true },
        },
      },
    });
  }
}
