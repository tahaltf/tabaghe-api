import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { Prisma, UserRole } from '@prisma/client';
import { PrismaService } from '../../../infrastructure/prisma/prisma.service';
import type { VaultPurgeTarget } from '../dto/admin-vault.dto';

const GODADMIN_PHONE = '09190949469';

export type VaultStats = Record<string, number>;

@Injectable()
export class AdminVaultService {
  private readonly logger = new Logger(AdminVaultService.name);

  constructor(private readonly prisma: PrismaService) {}

  expectedConfirmPhrase(target: VaultPurgeTarget): string {
    return `PURGE:${target}`;
  }

  async getStats(): Promise<VaultStats> {
    const contactWhere = {
      key: { startsWith: 'CONTACT_MESSAGE_' },
    } satisfies Prisma.SystemSettingWhereInput;

    const [
      users,
      godadmins,
      listings,
      orders,
      notifications,
      tickets,
      ticketMessages,
      exchangeOffers,
      repairs,
      conversations,
      messages,
      reviews,
      quotaLedger,
      planPurchases,
      walletTransactions,
      wallets,
      otpCodes,
      idempotencyKeys,
      contactMessages,
      blogPosts,
      faqs,
      savedListings,
      auctionBids,
      secondChanceOffers,
    ] = await Promise.all([
      this.prisma.user.count(),
      this.prisma.user.count({ where: { role: UserRole.GODADMIN } }),
      this.prisma.listing.count(),
      this.prisma.order.count(),
      this.prisma.notification.count(),
      this.prisma.ticket.count(),
      this.prisma.ticketMessage.count(),
      this.prisma.exchangeOffer.count(),
      this.prisma.repairRequest.count(),
      this.prisma.conversation.count(),
      this.prisma.message.count(),
      this.prisma.review.count(),
      this.prisma.quotaLedger.count(),
      this.prisma.userPlanPurchase.count(),
      this.prisma.walletTransaction.count(),
      this.prisma.wallet.count(),
      this.prisma.otpCode.count(),
      this.prisma.idempotencyKey.count(),
      this.prisma.systemSetting.count({ where: contactWhere }),
      this.prisma.blogPost.count(),
      this.prisma.faq.count(),
      this.prisma.savedListing.count(),
      this.prisma.auctionBid.count(),
      this.prisma.secondChanceOffer.count(),
    ]);

    return {
      users,
      godadmins,
      deletableUsers: Math.max(0, users - godadmins),
      listings,
      orders,
      notifications,
      tickets,
      ticketMessages,
      exchangeOffers,
      repairs,
      conversations,
      messages,
      reviews,
      quotaLedger,
      planPurchases,
      walletTransactions,
      wallets,
      otpCodes,
      idempotencyKeys,
      contactMessages,
      blogPosts,
      faqs,
      savedListings,
      auctionBids,
      secondChanceOffers,
    };
  }

  async purge(
    target: VaultPurgeTarget,
    confirmPhrase: string,
    actorUserId: string,
  ): Promise<{ target: VaultPurgeTarget; deleted: Record<string, number> }> {
    if (confirmPhrase !== this.expectedConfirmPhrase(target)) {
      throw new BadRequestException(
        `عبارت تأیید نادرست است. باید دقیقاً «${this.expectedConfirmPhrase(target)}» باشد.`,
      );
    }

    this.logger.warn(
      `GODADMIN vault purge requested: target=${target} actor=${actorUserId}`,
    );

    const deleted =
      target === 'operationalAll'
        ? await this.purgeOperationalAll()
        : await this.purgeSingle(target);

    this.logger.warn(
      `GODADMIN vault purge completed: target=${target} actor=${actorUserId} deleted=${JSON.stringify(deleted)}`,
    );

    return { target, deleted };
  }

  private async purgeSingle(
    target: VaultPurgeTarget,
  ): Promise<Record<string, number>> {
    switch (target) {
      case 'listings':
        return this.purgeListings();
      case 'users':
        return this.purgeUsers();
      case 'orders':
        return { orders: (await this.prisma.order.deleteMany()).count };
      case 'walletTransactions':
        return {
          walletTransactions: (await this.prisma.walletTransaction.deleteMany())
            .count,
        };
      case 'notifications':
        return {
          notifications: (await this.prisma.notification.deleteMany()).count,
        };
      case 'tickets':
        return this.purgeTickets();
      case 'exchangeOffers':
        return {
          exchangeOffers: (await this.prisma.exchangeOffer.deleteMany()).count,
        };
      case 'repairs':
        return {
          repairRequests: (await this.prisma.repairRequest.deleteMany()).count,
        };
      case 'chats':
        return this.purgeChats();
      case 'reviews':
        return { reviews: (await this.prisma.review.deleteMany()).count };
      case 'quotaLedger':
        return {
          quotaLedger: (await this.prisma.quotaLedger.deleteMany()).count,
        };
      case 'planPurchases':
        return {
          planPurchases: (await this.prisma.userPlanPurchase.deleteMany())
            .count,
        };
      case 'otpCodes':
        return { otpCodes: (await this.prisma.otpCode.deleteMany()).count };
      case 'idempotencyKeys':
        return {
          idempotencyKeys: (await this.prisma.idempotencyKey.deleteMany())
            .count,
        };
      case 'contactMessages':
        return this.purgeContactMessages();
      case 'blogPosts':
        return { blogPosts: (await this.prisma.blogPost.deleteMany()).count };
      case 'faqs':
        return { faqs: (await this.prisma.faq.deleteMany()).count };
      case 'savedListings':
        return {
          savedListings: (await this.prisma.savedListing.deleteMany()).count,
        };
      case 'auctionData':
        return this.purgeAuctionData();
      default:
        throw new BadRequestException('هدف پاکسازی نامعتبر است');
    }
  }

  private async purgeOperationalAll(): Promise<Record<string, number>> {
    return this.prisma.$transaction(
      async (tx) => {
        const out: Record<string, number> = {};

        out.messages = (await tx.message.deleteMany()).count;
        out.conversations = (await tx.conversation.deleteMany()).count;
        out.reviews = (await tx.review.deleteMany()).count;
        out.orders = (await tx.order.deleteMany()).count;
        out.quotaLedger = (await tx.quotaLedger.deleteMany()).count;
        out.exchangeOffers = (await tx.exchangeOffer.deleteMany()).count;
        out.auctionBids = (await tx.auctionBid.deleteMany()).count;
        out.secondChanceOffers = (
          await tx.secondChanceOffer.deleteMany()
        ).count;
        out.savedListings = (await tx.savedListing.deleteMany()).count;
        out.listings = (await tx.listing.deleteMany()).count;
        out.ticketMessages = (await tx.ticketMessage.deleteMany()).count;
        out.tickets = (await tx.ticket.deleteMany()).count;
        out.repairRequests = (await tx.repairRequest.deleteMany()).count;
        out.notifications = (await tx.notification.deleteMany()).count;
        out.planPurchases = (await tx.userPlanPurchase.deleteMany()).count;
        out.walletTransactions = (
          await tx.walletTransaction.deleteMany()
        ).count;
        out.wallets = (await tx.wallet.deleteMany()).count;
        out.addresses = (await tx.address.deleteMany()).count;
        out.otpCodes = (await tx.otpCode.deleteMany()).count;
        out.idempotencyKeys = (await tx.idempotencyKey.deleteMany()).count;
        out.contactMessages = (
          await tx.systemSetting.deleteMany({
            where: { key: { startsWith: 'CONTACT_MESSAGE_' } },
          })
        ).count;
        out.users = (
          await tx.user.deleteMany({
            where: { role: { not: UserRole.GODADMIN } },
          })
        ).count;

        return out;
      },
      { timeout: 120_000 },
    );
  }

  private async purgeListings(): Promise<Record<string, number>> {
    return this.prisma.$transaction(async (tx) => {
      const orders = (await tx.order.deleteMany()).count;
      const exchangeOffers = (await tx.exchangeOffer.deleteMany()).count;
      const auctionBids = (await tx.auctionBid.deleteMany()).count;
      const secondChanceOffers = (await tx.secondChanceOffer.deleteMany())
        .count;
      const savedListings = (await tx.savedListing.deleteMany()).count;
      const quotaOnListings = (
        await tx.quotaLedger.deleteMany({
          where: { listingId: { not: null } },
        })
      ).count;
      const listings = (await tx.listing.deleteMany()).count;
      return {
        orders,
        exchangeOffers,
        auctionBids,
        secondChanceOffers,
        savedListings,
        quotaOnListings,
        listings,
      };
    });
  }

  private async purgeUsers(): Promise<Record<string, number>> {
    return this.prisma.$transaction(
      async (tx) => {
        const preserve: Prisma.UserWhereInput = {
          OR: [{ role: UserRole.GODADMIN }, { phone: GODADMIN_PHONE }],
        };

        const deletableUsers = await tx.user.findMany({
          where: { NOT: preserve },
          select: { id: true },
        });
        const ids = deletableUsers.map((u) => u.id);
        if (ids.length === 0) {
          return { users: 0 };
        }

        const out: Record<string, number> = {};

        out.messages = (
          await tx.message.deleteMany({
            where: {
              OR: [{ senderId: { in: ids } }],
            },
          })
        ).count;

        out.conversations = (
          await tx.conversation.deleteMany({
            where: {
              OR: [{ buyerId: { in: ids } }, { sellerId: { in: ids } }],
            },
          })
        ).count;

        out.reviews = (
          await tx.review.deleteMany({
            where: {
              OR: [{ reviewerId: { in: ids } }, { revieweeId: { in: ids } }],
            },
          })
        ).count;

        out.orders = (
          await tx.order.deleteMany({
            where: {
              OR: [{ buyerId: { in: ids } }, { sellerId: { in: ids } }],
            },
          })
        ).count;

        out.quotaLedger = (
          await tx.quotaLedger.deleteMany({ where: { userId: { in: ids } } })
        ).count;

        out.exchangeOffers = (
          await tx.exchangeOffer.deleteMany({
            where: { offererId: { in: ids } },
          })
        ).count;

        out.auctionBids = (
          await tx.auctionBid.deleteMany({ where: { bidderId: { in: ids } } })
        ).count;

        out.secondChanceOffers = (
          await tx.secondChanceOffer.deleteMany({
            where: { userId: { in: ids } },
          })
        ).count;

        out.savedListings = (
          await tx.savedListing.deleteMany({ where: { userId: { in: ids } } })
        ).count;

        out.listings = (
          await tx.listing.deleteMany({ where: { authorId: { in: ids } } })
        ).count;

        out.tickets = (
          await tx.ticket.deleteMany({ where: { userId: { in: ids } } })
        ).count;
        out.ticketMessages = 0;

        out.repairRequests = (
          await tx.repairRequest.deleteMany({ where: { userId: { in: ids } } })
        ).count;

        out.notifications = (
          await tx.notification.deleteMany({ where: { userId: { in: ids } } })
        ).count;

        out.planPurchases = (
          await tx.userPlanPurchase.deleteMany({
            where: { userId: { in: ids } },
          })
        ).count;

        out.walletTransactions = (
          await tx.walletTransaction.deleteMany({
            where: { wallet: { userId: { in: ids } } },
          })
        ).count;

        out.wallets = (
          await tx.wallet.deleteMany({ where: { userId: { in: ids } } })
        ).count;

        out.addresses = (
          await tx.address.deleteMany({ where: { userId: { in: ids } } })
        ).count;

        out.users = (
          await tx.user.deleteMany({ where: { id: { in: ids } } })
        ).count;

        return out;
      },
      { timeout: 120_000 },
    );
  }

  private async purgeTickets(): Promise<Record<string, number>> {
    return this.prisma.$transaction(async (tx) => {
      const ticketMessages = (await tx.ticketMessage.deleteMany()).count;
      const tickets = (await tx.ticket.deleteMany()).count;
      return { ticketMessages, tickets };
    });
  }

  private async purgeChats(): Promise<Record<string, number>> {
    return this.prisma.$transaction(async (tx) => {
      const messages = (await tx.message.deleteMany()).count;
      const conversations = (await tx.conversation.deleteMany()).count;
      return { messages, conversations };
    });
  }

  private async purgeContactMessages(): Promise<Record<string, number>> {
    return {
      contactMessages: (
        await this.prisma.systemSetting.deleteMany({
          where: { key: { startsWith: 'CONTACT_MESSAGE_' } },
        })
      ).count,
    };
  }

  private async purgeAuctionData(): Promise<Record<string, number>> {
    return this.prisma.$transaction(async (tx) => {
      const auctionBids = (await tx.auctionBid.deleteMany()).count;
      const secondChanceOffers = (await tx.secondChanceOffer.deleteMany())
        .count;
      return { auctionBids, secondChanceOffers };
    });
  }
}
