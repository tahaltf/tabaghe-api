import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  AuctionBidStatus,
  AuctionStatus,
  AuctionSettlementStatus,
  ListingType,
  SecondChanceOfferStatus,
} from '@prisma/client';
import Decimal from 'decimal.js';
import { PrismaService } from '../../../infrastructure/prisma/prisma.service';

import { AuctionSupportService } from './auction-support.service';


@Injectable()
export class AuctionQueryService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly support: AuctionSupportService,
  ) {}

  async getAuctionState(listingId: string, viewerUserId?: string) {
    const auction = await this.prisma.listingAuction.findUnique({
      where: { listingId },
      include: { listing: { select: { title: true, authorId: true } } },
    });

    if (!auction) throw new NotFoundException('مزایده یافت نشد');

    const bidCount = await this.prisma.auctionBid.count({
      where: { listingId },
    });
    const remainingMs =
      auction.status === AuctionStatus.ACTIVE
        ? Math.max(0, auction.endDatetime.getTime() - Date.now())
        : 0;

    const isOwner = !!viewerUserId && viewerUserId === auction.listing.authorId;
    const isHighestBidder =
      !!viewerUserId && viewerUserId === auction.highestBidderId;
    // ID برندگان فقط به خود کاربر (اگر برنده/دومه) و مالک آگهی نمایش داده میشه.
    // برای کاربران عمومی، فقط اطلاع از وجود/مبلغ میدیم نه هویت.
    return {
      listingId,
      title: auction.listing.title,
      auctionStatus: auction.status,
      basePrice: auction.basePrice,
      highestBid: auction.highestBidAmount,
      highestBidderId:
        isOwner || isHighestBidder ? auction.highestBidderId : null,
      isHighestBidder,
      bidCount,
      minBidIncrement: auction.minBidIncrement,
      buyNowEnabled: auction.buyNowEnabled,
      buyNowPrice: auction.buyNowPrice,
      endDatetime: auction.endDatetime,
      remainingMs,
      settlementStatus: auction.settlementStatus,
      paymentDeadline: auction.paymentDeadline,
    };
  }

  async getAuctionBids(listingId: string, viewerUserId?: string) {
    const auction = await this.prisma.listingAuction.findUnique({
      where: { listingId },
      select: { listing: { select: { authorId: true } } },
    });
    const isOwner =
      !!auction && !!viewerUserId && auction.listing.authorId === viewerUserId;

    const rows = await this.prisma.auctionBid.findMany({
      where: { listingId },
      orderBy: { createdAt: 'desc' },
      take: 50,
      select: {
        amount: true,
        bidderId: true,
        createdAt: true,
        status: true,
        bidder: { select: { firstName: true, lastName: true, displayName: true, avatar: true } },
      },
    });

    return rows.map((b) => ({
      amount: b.amount,
      createdAt: b.createdAt,
      status: b.status,
      // شناسه‌ی دقیق فقط به مالک و خود پیشنهاددهنده برمیگرده.
      bidderId: isOwner || b.bidderId === viewerUserId ? b.bidderId : null,
      isMine: b.bidderId === viewerUserId,
      bidder: {
        displayName: b.bidder?.displayName ?? null,
        firstName: b.bidder?.displayName ? null : (b.bidder?.firstName ?? null),
        lastName: b.bidder?.displayName
          ? null
          : b.bidder?.lastName
            ? `${b.bidder.lastName.charAt(0)}.`
            : null,
        avatar: b.bidder?.avatar ?? null,
      },
    }));
  }

  async getAuctionCheckoutData(listingId: string, userId: string) {
    const listing = await this.prisma.listing.findUnique({
      where: { id: listingId },
      include: {
        auction: {
          include: {
            bids: {
              where: { bidderId: userId },
              orderBy: { amount: 'desc' },
              take: 1,
            },
          },
        },
        author: { select: { id: true, firstName: true, lastName: true, displayName: true } },
      },
    });

    if (!listing || !listing.auction) {
      throw new NotFoundException('آگهی مزایده یافت نشد');
    }

    const userBid = listing.auction.bids[0];
    if (!userBid) {
      throw new ForbiddenException('شما هیچ پیشنهادی در این مزایده ندارید');
    }
    if (listing.auction.highestBidderId !== userId) {
      throw new ForbiddenException(
        'فقط برنده فعلی مجاز به ادامه پرداخت مزایده است',
      );
    }

    const finishedAt = listing.auction.finishedAt
      ? new Date(listing.auction.finishedAt).getTime()
      : 0;
    const deadlineAt = listing.auction.paymentDeadline
      ? new Date(listing.auction.paymentDeadline).getTime()
      : 0;
    const windowHours =
      finishedAt > 0 && deadlineAt > finishedAt
        ? (deadlineAt - finishedAt) / (60 * 60 * 1000)
        : null;
    const isSecondChanceRound = windowHours != null && windowHours <= 24 + 1;
    if (isSecondChanceRound) {
      const offered = await this.prisma.secondChanceOffer.findFirst({
        where: {
          listingId,
          userId,
          status: 'OFFERED',
          expiresAt: { gt: new Date() },
        },
        orderBy: { createdAt: 'desc' },
        select: { id: true },
      });
      if (!offered) {
        throw new ForbiddenException('شانس دوم برای این کاربر فعال نیست');
      }
    }

    const bidAmount = new Decimal(userBid.amount);
    const depositPercent = await this.support.getAuctionDepositPercent(
      this.prisma,
      listingId,
    );
    const blockedAmount = await this.support.getFixedDepositAmount(
      this.prisma,
      listingId,
    );
    const payableAmount = bidAmount.minus(blockedAmount);

    return {
      listing: {
        id: listing.id,
        title: listing.title,
        thumbnail: listing.thumbnail,
        shippingPayer: listing.shippingPayer,
        author: listing.author,
      },
      bidAmount: bidAmount.toNumber(),
      blockedAmount: blockedAmount.toNumber(),
      payableAmount: payableAmount.toNumber(),
      depositPercent: depositPercent.toNumber(),
    };
  }
}
