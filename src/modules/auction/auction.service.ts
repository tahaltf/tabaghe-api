import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { WalletService } from '../wallet/wallet.service';
import { FeeCalculatorService } from '../fees/fee-calculator.service'; // 👈 اضافه شد
import {
  AuctionBidStatus,
  AuctionStatus,
  AuctionSettlementStatus,
  ListingType, // 👈 اضافه شد
} from '@prisma/client';
import Decimal from 'decimal.js';
import { AuctionGateway } from './auction.gateway';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { AuctionEvents } from './auction.events';
import { Cron, CronExpression } from '@nestjs/schedule';

@Injectable()
export class AuctionService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly walletService: WalletService,
    private readonly feeCalculator: FeeCalculatorService, // 👈 تزریق شد
    private readonly auctionGateway: AuctionGateway,
    private readonly eventEmitter: EventEmitter2,
  ) {}

  // -----------------------------------
  // Place bid (اصلاح شده با فرمت پول)
  // -----------------------------------
  async placeBid(userId: string, listingId: string, amount: number) {
    const bidAmount = new Decimal(amount);

    if (bidAmount.lte(0)) {
      throw new BadRequestException('مبلغ پیشنهادی نامعتبر است');
    }

    const result = await this.prisma.$transaction(async (tx) => {
      const auction = await tx.listingAuction.findUnique({
        where: { listingId },
      });

      if (!auction) throw new NotFoundException('مزایده یافت نشد');
      if (auction.status !== AuctionStatus.ACTIVE) {
        throw new ForbiddenException('مزایده فعال نیست');
      }
      if (new Date() >= auction.endDatetime) {
        throw new ForbiddenException('زمان مزایده تمام شده است');
      }

      const currentHighest = auction.highestBidAmount
        ? new Decimal(auction.highestBidAmount)
        : null;

      const minIncrement = new Decimal(auction.minBidIncrement);

      const minRequired = currentHighest
        ? currentHighest.plus(minIncrement)
        : new Decimal(auction.basePrice);

      if (bidAmount.lt(minRequired)) {
        throw new BadRequestException(
          `مبلغ پیشنهادی باید حداقل ${minRequired.toNumber().toLocaleString()} تومان باشد`,
        );
      }

      if (auction.highestBidderId === userId) {
        throw new BadRequestException('شما در حال حاضر بالاترین پیشنهاد را دارید');
      }

      const DEPOSIT_PERCENTAGE = 0.1;
      const depositAmount = bidAmount.mul(DEPOSIT_PERCENTAGE);

      if (depositAmount.lte(0)) {
        throw new BadRequestException('خطا در محاسبه ودیعه (مبلغ نامعتبر)');
      }

      await this.walletService.blockAmount(
        userId,
        depositAmount,
        listingId,
        tx,
      );

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

      const newBid = await tx.auctionBid.create({
        data: {
          listingId,
          bidderId: userId,
          amount: bidAmount,
          blockedAmount: depositAmount,
          status: AuctionBidStatus.ACTIVE,
        },
      });

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

      await tx.listingAuction.update({
        where: { listingId },
        data: {
          status: AuctionStatus.FINISHED,
          settlementStatus: AuctionSettlementStatus.PENDING,
          paymentDeadline: new Date(Date.now() + 24 * 60 * 60 * 1000),
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
  // Pay auction (با کسر کارمزد داینامیک)
  // -----------------------------------
  async payAuction(userId: string | null, listingId: string) {
    return this.prisma.$transaction(async (tx) => {
      const auction = await tx.listingAuction.findUnique({
        where: { listingId },
        include: { listing: true },
      });

      if (!auction) throw new NotFoundException('Auction not found');

      if (userId && auction.highestBidderId !== userId) {
        throw new ForbiddenException('شما برنده فعلی مزایده نیستید');
      }
      if (auction.settlementStatus !== AuctionSettlementStatus.PENDING) {
        throw new BadRequestException('مزایده قبلا تسویه شده یا منقضی شده است');
      }

      const payerId = userId || auction.highestBidderId;

      if (!payerId) {
        throw new BadRequestException('برنده‌ای برای پرداخت وجود ندارد');
      }

      const winnerBid = await tx.auctionBid.findFirst({
        where: { listingId, bidderId: payerId, status: AuctionBidStatus.ACTIVE },
        orderBy: { amount: 'desc' },
      });

      const totalAmount = new Decimal(auction.highestBidAmount!);
      const blockedDeposit = new Decimal(winnerBid?.blockedAmount || 0);

      // 👈 محاسبه کارمزد پلتفرم برای مزایده
      const platformFee = await this.feeCalculator.calculateFee(
        ListingType.AUCTION,
        auction.listing.categoryId,
        totalAmount
      );

      await this.walletService.payAuctionFinal(
        payerId,
        auction.listing.authorId,
        totalAmount,
        blockedDeposit,
        platformFee, // 👈 جایگزین 0 شد
        listingId,
        tx
      );

      const others = [auction.secondBidderId, auction.thirdBidderId].filter((id) => id);
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

      if (winnerBid) {
        await tx.auctionBid.update({
          where: { id: winnerBid.id },
          data: { status: AuctionBidStatus.WON }
        });
      }

      return { ok: true, message: 'پرداخت با موفقیت انجام شد' };
    });
  }

  // -----------------------------------
  // CRON & PROCESS LOGIC
  // -----------------------------------

  @Cron(CronExpression.EVERY_10_MINUTES)
  async checkUnpaidAuctions() {
    const now = new Date();
    const expiredAuctions = await this.prisma.listingAuction.findMany({
      where: {
        status: AuctionStatus.FINISHED,
        settlementStatus: AuctionSettlementStatus.PENDING,
        paymentDeadline: { lt: now },
      },
    });

    for (const auction of expiredAuctions) {
      await this.processNextWinner(auction.listingId);
    }
  }

  async penalizeWinner(listingId: string) {
    return this.processNextWinner(listingId);
  }

  private async processNextWinner(listingId: string) {
    await this.prisma.$transaction(async (tx) => {
      const auction = await tx.listingAuction.findUnique({ where: { listingId } });

      if (auction.highestBidderId) {
        const currentBid = await tx.auctionBid.findFirst({
          where: { listingId, bidderId: auction.highestBidderId, status: AuctionBidStatus.ACTIVE },
          orderBy: { amount: 'desc' }
        });

        if (currentBid && Number(currentBid.blockedAmount) > 0) {
          await this.walletService.confiscateBlocked(
            auction.highestBidderId,
            currentBid.blockedAmount,
            listingId,
            tx
          );

          await tx.auctionBid.update({
            where: { id: currentBid.id },
            data: { status: AuctionBidStatus.LOST }
          });
        }
      }

      const nextUserId = auction.secondBidderId;

      if (nextUserId) {
        const nextBid = await tx.auctionBid.findFirst({
          where: { listingId, bidderId: nextUserId },
          orderBy: { amount: 'desc' }
        });

        await tx.listingAuction.update({
          where: { listingId },
          data: {
            highestBidderId: nextUserId,
            highestBidAmount: nextBid.amount,
            secondBidderId: auction.thirdBidderId,
            thirdBidderId: null,
            paymentDeadline: new Date(Date.now() + 24 * 60 * 60 * 1000),
          }
        });
      } else {
        await tx.listingAuction.update({
          where: { listingId },
          data: { settlementStatus: AuctionSettlementStatus.FAILED }
        });
      }
    });
  }

  // -----------------------------------
  // Buy now (با کسر کارمزد و Escrow امن)
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

      // 👈 محاسبه کارمزد پلتفرم
      const platformFee = await this.feeCalculator.calculateFee(
        ListingType.AUCTION,
        auction.listing.categoryId,
        amount
      );

      // 👈 استفاده از Escrow (پول در حساب بلوکه فروشنده می‌ماند)
      await this.walletService.transferToEscrow(
        userId,
        auction.listing.authorId,
        amount,
        platformFee,
        listingId,
        tx
      );

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
      settlementStatus: auction.settlementStatus,
      paymentDeadline: auction.paymentDeadline,
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
  // Admin Methods
  // -----------------------------------

  async forcePenalizeWinner(listingId: string) {
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
        data: { settlementStatus: AuctionSettlementStatus.FAILED },
      });
      return { ok: true, message: 'مزایده لغو و مبالغ عودت داده شد' };
    });
  }

  async forceSettleAuction(listingId: string) {
    return this.payAuction(null, listingId);
  }
}