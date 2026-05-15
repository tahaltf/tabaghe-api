import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../../infrastructure/prisma/prisma.service';

export type ListingHardDeleteResult = {
  deleted: number;
  details: Record<string, number>;
};

@Injectable()
export class AdminListingDeleteService {
  constructor(private readonly prisma: PrismaService) {}

  async hardDeleteMany(ids: string[]): Promise<ListingHardDeleteResult> {
    const unique = [...new Set(ids.map((id) => id.trim()).filter(Boolean))];
    if (unique.length === 0) {
      return { deleted: 0, details: {} };
    }

    return this.prisma.$transaction(
      async (tx) => {
        const details = await this.deleteListingsTx(tx, unique);
        return { deleted: details.listings ?? 0, details };
      },
      { timeout: 120_000 },
    );
  }

  async hardDeleteOne(id: string): Promise<ListingHardDeleteResult> {
    return this.hardDeleteMany([id]);
  }

  /** حذف کامل وابستگی‌های آگهی قبل از deleteMany روی Listing */
  async deleteListingsTx(
    tx: Prisma.TransactionClient,
    listingIds: string[],
  ): Promise<Record<string, number>> {
    if (listingIds.length === 0) return { listings: 0 };

    const conversations = await tx.conversation.findMany({
      where: { listingId: { in: listingIds } },
      select: { id: true },
    });
    const conversationIds = conversations.map((c) => c.id);

    const out: Record<string, number> = {};

    if (conversationIds.length > 0) {
      out.messages = (
        await tx.message.deleteMany({
          where: { conversationId: { in: conversationIds } },
        })
      ).count;
      out.conversations = (
        await tx.conversation.deleteMany({
          where: { id: { in: conversationIds } },
        })
      ).count;
    } else {
      out.messages = 0;
      out.conversations = 0;
    }

    out.reviews = (
      await tx.review.deleteMany({
        where: { order: { listingId: { in: listingIds } } },
      })
    ).count;

    out.orders = (
      await tx.order.deleteMany({ where: { listingId: { in: listingIds } } })
    ).count;

    out.exchangeOffers = (
      await tx.exchangeOffer.deleteMany({
        where: { listingId: { in: listingIds } },
      })
    ).count;

    out.auctionBids = (
      await tx.auctionBid.deleteMany({
        where: { listingId: { in: listingIds } },
      })
    ).count;

    out.secondChanceOffers = (
      await tx.secondChanceOffer.deleteMany({
        where: { listingId: { in: listingIds } },
      })
    ).count;

    out.savedListings = (
      await tx.savedListing.deleteMany({
        where: { listingId: { in: listingIds } },
      })
    ).count;

    out.quotaLedger = (
      await tx.quotaLedger.deleteMany({
        where: { listingId: { in: listingIds } },
      })
    ).count;

    out.listings = (
      await tx.listing.deleteMany({ where: { id: { in: listingIds } } })
    ).count;

    return out;
  }
}
