import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { WalletService } from '../wallet/wallet.service';
import {
  AuctionBidStatus,
  AuctionStatus,
  AuctionSettlementStatus,
} from '@prisma/client';
import Decimal from 'decimal.js';
import { AuctionGateway } from './auction.gateway';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { AuctionEvents } from './auction.events';

@Injectable()
export class AuctionService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly walletService: WalletService,
    private readonly auctionGateway: AuctionGateway,
    private readonly eventEmitter: EventEmitter2,
  ) {}

  // -----------------------------------
  // Place bid (با منطق مدیریت ۳ نفر اول و ودیعه)
  // -----------------------------------
  async placeBid(userId: string, listingId: string, amount: number) {
    const bidAmount = new Decimal(amount);
    if (bidAmount.lte(0)) {
      throw new BadRequestException('Invalid bid amount');
    }

    const result = await this.prisma.$transaction(async (tx) => {
      const auction = await tx.listingAuction.findUnique({
        where: { listingId },
      });

      if (!auction) throw new NotFoundException('Auction not found');
      if (auction.status !== AuctionStatus.ACTIVE) {
        throw new ForbiddenException('Auction is not active');
      }
      if (new Date() >= auction.endDatetime) {
        throw new ForbiddenException('Auction has ended');
      }

      const currentHighest = auction.highestBidAmount
        ? new Decimal(auction.highestBidAmount)
        : null;

      const minRequired = currentHighest
        ? currentHighest.plus(auction.minBidIncrement)
        : new Decimal(auction.basePrice);

      if (bidAmount.lt(minRequired)) {
        throw new BadRequestException(
          `Bid must be >= ${minRequired.toString()}`,
        );
      }

      if (auction.highestBidderId === userId) {
        throw new BadRequestException('You already have the highest bid');
      }

      // تعیین مبلغ ودیعه (مثلاً ۱۰٪ پیشنهاد)
      const depositAmount = bidAmount.mul(0.1);

      // ۱. بلوکه کردن ودیعه نفر جدید
      await this.walletService.blockAmount(
        userId,
        depositAmount,
        listingId,
        tx,
      );

      // ۲. اگر نفر چهارمی در راه است (نفر سوم فعلی باید آزاد شود)
      if (auction.thirdBidderId) {
        const thirdBid = await tx.auctionBid.findFirst({
          where: {
            listingId,
            bidderId: auction.thirdBidderId,
            status: AuctionBidStatus.ACTIVE,
          },
          orderBy: { amount: 'desc' },
        });

        if (thirdBid) {
          await this.walletService.unblockAmount(
            thirdBid.bidderId,
            thirdBid.blockedAmount,
            listingId,
            tx,
          );
          await tx.auctionBid.update({
            where: { id: thirdBid.id },
            data: { status: AuctionBidStatus.OUTBID },
          });
        }
      }

      // ۳. ایجاد رکورد پیشنهاد
      const newBid = await tx.auctionBid.create({
        data: {
          listingId,
          bidderId: userId,
          amount: bidAmount,
          blockedAmount: depositAmount,
          status: AuctionBidStatus.ACTIVE,
        },
      });

      // ۴. جابجایی صف در جدول اصلی (Shifting)
      await tx.listingAuction.update({
        where: { listingId },
        data: {
          highestBidAmount: bidAmount,
          highestBidderId: userId,
          secondBidderId: auction.highestBidderId,
          thirdBidderId: auction.secondBidderId,
        },
      });

      return newBid;
    });

    // realtime + event
    this.auctionGateway.emitBidPlaced(listingId, {
      bidderId: userId,
      amount: result.amount,
    });

    this.eventEmitter.emit(AuctionEvents.BID_PLACED, {
      listingId,
      bidderId: userId,
      amount: bidAmount.toString(),
    });

    return { ok: true, bid: result };
  }

  // -----------------------------------
  // Finalize auction
  // -----------------------------------
  async finalizeAuction(listingId: string) {
    const result = await this.prisma.$transaction(async (tx) => {
      const auction = await tx.listingAuction.findUnique({
        where: { listingId },
      });

      if (!auction) throw new NotFoundException('Auction not found');
      if (auction.status === AuctionStatus.FINISHED) return null;
      if (auction.endDatetime > new Date()) {
        throw new BadRequestException('Auction not ended yet');
      }

      // چک کردن وجود شرکت‌کننده
      if (!auction.highestBidderId) {
        await tx.listingAuction.update({
          where: { listingId },
          data: {
            status: AuctionStatus.FINISHED,
            finishedAt: new Date(),
          },
        });
        return { winner: null };
      }

      // وضعیت را به تمام شده تغییر می‌دهیم (ودیعه ۳ نفر اول فعلاً بلوکه می‌ماند)
      await tx.listingAuction.update({
        where: { listingId },
        data: {
          status: AuctionStatus.FINISHED,
          settlementStatus: AuctionSettlementStatus.PENDING,
          paymentDeadline: new Date(Date.now() + 24 * 60 * 60 * 1000), // ۲۴ ساعت مهلت
          finishedAt: new Date(),
        },
      });

      return {
        winnerUserId: auction.highestBidderId,
        amount: auction.highestBidAmount,
      };
    });

    if (result?.winnerUserId) {
      this.auctionGateway.emitAuctionFinished(listingId, result);
      this.eventEmitter.emit(AuctionEvents.FINISHED, {
        listingId,
        winnerUserId: result.winnerUserId,
        amount: result.amount.toString(),
      });
    }

    return result;
  }

  // -----------------------------------
  // Pay auction
  // -----------------------------------
  async payAuction(userId: string, listingId: string) {
    return this.prisma.$transaction(async (tx) => {
      const auction = await tx.listingAuction.findUnique({
        where: { listingId },
        include: { listing: true },
      });

      if (!auction) throw new NotFoundException('Auction not found');
      if (auction.highestBidderId !== userId) {
        throw new ForbiddenException('Only winner can pay');
      }
      if (auction.settlementStatus !== AuctionSettlementStatus.PENDING) {
        throw new BadRequestException('Already settled');
      }
      if (!auction.paymentDeadline || auction.paymentDeadline < new Date()) {
        throw new BadRequestException('Payment expired');
      }

      const winnerBid = await tx.auctionBid.findFirst({
        where: { listingId, bidderId: userId, status: AuctionBidStatus.ACTIVE },
        orderBy: { amount: 'desc' },
      });

      const totalAmount = new Decimal(auction.highestBidAmount!);
      const blockedAmount = new Decimal(winnerBid?.blockedAmount || 0);
      const remainder = totalAmount.minus(blockedAmount);

      // ۱. تسویه ودیعه قبلی
      await this.walletService.settleBlockedAmount(
        userId,
        blockedAmount,
        listingId,
        tx,
      );

      // ۲. کسر مابه‌تفاوت از موجودی آزاد
      if (remainder.gt(0)) {
        await this.walletService.payFromAvailable(
          userId,
          remainder,
          listingId,
          tx,
        );
      }

      // ۳. انتقال به فروشنده
      await this.walletService.transfer({
        fromUserId: userId,
        toUserId: auction.listing.authorId,
        amount: totalAmount,
        referenceId: listingId,
        tx,
      });

      // ۴. آزادسازی ودیعه نفرات دوم و سوم (چون معامله قطعی شد)
      const others = [auction.secondBidderId, auction.thirdBidderId].filter(
        (id) => id,
      );
      for (const otherId of others) {
        const otherBid = await tx.auctionBid.findFirst({
          where: {
            listingId,
            bidderId: otherId!,
            status: AuctionBidStatus.ACTIVE,
          },
          orderBy: { amount: 'desc' },
        });
        if (otherBid) {
          await this.walletService.unblockAmount(
            otherId!,
            otherBid.blockedAmount,
            listingId,
            tx,
          );
        }
      }

      await tx.listingAuction.update({
        where: { listingId },
        data: {
          settlementStatus: AuctionSettlementStatus.PAID,
        },
      });

      return { ok: true };
    });
  }

  // -----------------------------------
  // Penalize winner (جریمه و پاس دادن به نفر بعدی)
  // -----------------------------------
  async penalizeWinner(listingId: string) {
    return await this.prisma.$transaction(async (tx) => {
      const auction = await tx.listingAuction.findUnique({
        where: { listingId },
      });

      if (
        !auction ||
        auction.settlementStatus !== AuctionSettlementStatus.PENDING
      )
        return;

      // ۱. جریمه نفر اول (برداشت ودیعه بلوکه شده)
      const winnerBid = await tx.auctionBid.findFirst({
        where: {
          listingId,
          bidderId: auction.highestBidderId!,
          status: AuctionBidStatus.ACTIVE,
        },
        orderBy: { amount: 'desc' },
      });

      if (winnerBid) {
        await this.walletService.applyPenalty(
          auction.highestBidderId!,
          winnerBid.blockedAmount,
          listingId,
          tx,
        );
      }

      // ۲. جابجایی: نفر دوم برنده می‌شود
      if (auction.secondBidderId) {
        const secondBid = await tx.auctionBid.findFirst({
          where: { listingId, bidderId: auction.secondBidderId },
          orderBy: { amount: 'desc' },
        });

        await tx.listingAuction.update({
          where: { listingId },
          data: {
            highestBidderId: auction.secondBidderId,
            highestBidAmount: secondBid?.amount,
            secondBidderId: auction.thirdBidderId,
            thirdBidderId: null, // یا نفر چهارم اگر لاگ داشته باشیم
            paymentDeadline: new Date(Date.now() + 24 * 60 * 60 * 1000),
          },
        });
      } else {
        await tx.listingAuction.update({
          where: { listingId },
          data: { settlementStatus: AuctionSettlementStatus.PENALIZED },
        });
      }
    });
  }

  // -----------------------------------
  // Buy now
  // -----------------------------------
  async buyNow(userId: string, listingId: string) {
    const result = await this.prisma.$transaction(async (tx) => {
      const auction = await tx.listingAuction.findUnique({
        where: { listingId },
        include: { listing: true },
      });

      if (!auction) throw new NotFoundException('Auction not found');
      if (auction.status !== AuctionStatus.ACTIVE)
        throw new ForbiddenException('Auction not active');
      if (!auction.buyNowEnabled || !auction.buyNowPrice)
        throw new BadRequestException('Buy Now not available');

      const amount = new Decimal(auction.buyNowPrice);

      // پرداخت کل مبلغ
      await this.walletService.payFromAvailable(userId, amount, listingId, tx);

      // آزادسازی تمام بیدهای بلوکه شده (۳ نفر اول)
      const bidders = [
        auction.highestBidderId,
        auction.secondBidderId,
        auction.thirdBidderId,
      ].filter((id) => id);
      for (const bId of bidders) {
        const bBid = await tx.auctionBid.findFirst({
          where: { listingId, bidderId: bId!, status: AuctionBidStatus.ACTIVE },
        });
        if (bBid) {
          await this.walletService.unblockAmount(
            bId!,
            bBid.blockedAmount,
            listingId,
            tx,
          );
        }
      }

      await tx.listingAuction.update({
        where: { listingId },
        data: {
          status: AuctionStatus.FINISHED,
          settlementStatus: AuctionSettlementStatus.PAID,
          finishedAt: new Date(),
          highestBidderId: userId,
          highestBidAmount: amount,
        },
      });

      await this.walletService.transfer({
        fromUserId: userId,
        toUserId: auction.listing.authorId,
        amount,
        referenceId: listingId,
        tx,
      });

      return { buyerId: userId, amount };
    });

    this.auctionGateway.emitAuctionFinished(listingId, {
      type: 'BUY_NOW',
      buyerId: result.buyerId,
      amount: result.amount,
    });
    return { ok: true, ...result };
  }

  // -----------------------------------
  // Read APIs
  // -----------------------------------
  async getAuctionState(listingId: string) {
    const auction = await this.prisma.listingAuction.findUnique({
      where: { listingId },
      include: { listing: { select: { title: true } } },
    });

    if (!auction) throw new NotFoundException('Auction not found');

    const bidCount = await this.prisma.auctionBid.count({
      where: { listingId },
    });
    const remainingMs =
      auction.status === AuctionStatus.ACTIVE
        ? Math.max(0, auction.endDatetime.getTime() - Date.now())
        : 0;

    return {
      listingId,
      title: auction.listing.title,
      auctionStatus: auction.status,
      basePrice: auction.basePrice,
      highestBid: auction.highestBidAmount,
      highestBidderId: auction.highestBidderId,
      secondBidderId: auction.secondBidderId,
      thirdBidderId: auction.thirdBidderId,
      bidCount,
      buyNowEnabled: auction.buyNowEnabled,
      buyNowPrice: auction.buyNowPrice,
      endDatetime: auction.endDatetime,
      remainingMs,
    };
  }

  async getAuctionBids(listingId: string) {
    return this.prisma.auctionBid.findMany({
      where: { listingId },
      orderBy: { createdAt: 'desc' },
      select: { amount: true, bidderId: true, createdAt: true, status: true },
    });
  }

  // -----------------------------------
  // Admin force actions
  // -----------------------------------
  async forceSettleAuction(listingId: string) {
    return this.payAuction(null, listingId); // متد payAuction را با دسترسی ادمین صدا بزنید
  }

  async forcePenalizeAuction(listingId: string) {
    return this.penalizeWinner(listingId);
  }

  async forceRefundAuction(listingId: string) {
    return this.prisma.$transaction(async (tx) => {
      const auction = await tx.listingAuction.findUnique({
        where: { listingId },
      });
      if (!auction) throw new NotFoundException();

      const bidders = [
        auction.highestBidderId,
        auction.secondBidderId,
        auction.thirdBidderId,
      ].filter((id) => id);
      for (const bId of bidders) {
        const bBid = await tx.auctionBid.findFirst({
          where: { listingId, bidderId: bId!, status: AuctionBidStatus.ACTIVE },
        });
        if (bBid)
          await this.walletService.unblockAmount(
            bId!,
            bBid.blockedAmount,
            listingId,
            tx,
          );
      }

      await tx.listingAuction.update({
        where: { listingId },
        data: { settlementStatus: AuctionSettlementStatus.FAILED },
      });
      return { ok: true };
    });
  }
}
