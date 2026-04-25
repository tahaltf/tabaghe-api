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

const TOP_BIDDERS_LIMIT = 4;
const BID_CANCEL_LOCK_HOURS = 12;
const LAST_MINUTE_EXTENSION_MINUTES = 10;
const DEFAULT_WINNER_PAYMENT_DEADLINE_HOURS = 24;

@Injectable()
export class AuctionService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly walletService: WalletService,
    private readonly feeCalculator: FeeCalculatorService, // 👈 تزریق شد
    private readonly auctionGateway: AuctionGateway,
    private readonly eventEmitter: EventEmitter2,
  ) {}

  private async getWinnerPaymentDeadlineHours(tx: any): Promise<number> {
    const row = await tx.systemSetting.findUnique({
      where: { key: 'AUCTION_WINNER_PAYMENT_DEADLINE_HOURS' },
      select: { value: true },
    });
    const parsed = Number(row?.value ?? DEFAULT_WINNER_PAYMENT_DEADLINE_HOURS);
    if (!Number.isFinite(parsed) || parsed <= 0) {
      return DEFAULT_WINNER_PAYMENT_DEADLINE_HOURS;
    }
    return Math.floor(parsed);
  }

  private async getAuctionDepositPercent(tx: any, listingId: string): Promise<Decimal> {
    const listing = await tx.listing.findUnique({
      where: { id: listingId },
      select: { categoryId: true, category: { select: { auctionDepositPercent: true } } },
    });
    if (!listing) throw new NotFoundException('آگهی یافت نشد');

    const feeRule = await tx.feeRule.findFirst({
      where: {
        listingType: ListingType.AUCTION,
        isActive: true,
        categoryId: listing.categoryId,
      },
      orderBy: { createdAt: 'desc' },
      select: { auctionDepositPercent: true },
    });

    const percent = feeRule?.auctionDepositPercent ?? listing.category?.auctionDepositPercent ?? 10;
    const dec = new Decimal(percent);
    return dec.gt(0) ? dec : new Decimal(10);
  }

  private async getTopActiveBids(tx: any, listingId: string) {
    const activeBids = await tx.auctionBid.findMany({
      where: { listingId, status: AuctionBidStatus.ACTIVE },
      orderBy: [{ amount: 'desc' }, { createdAt: 'asc' }],
    });
    const topBids: any[] = [];
    const bidderSeen = new Set<string>();
    for (const bid of activeBids) {
      if (bidderSeen.has(bid.bidderId)) continue;
      topBids.push(bid);
      bidderSeen.add(bid.bidderId);
      if (topBids.length >= TOP_BIDDERS_LIMIT) break;
    }
    return { topBids, activeBids };
  }

  private async syncAuctionRanking(tx: any, listingId: string) {
    const { topBids } = await this.getTopActiveBids(tx, listingId);
    await tx.listingAuction.update({
      where: { listingId },
      data: {
        highestBidAmount: topBids[0]?.amount ?? null,
        highestBidderId: topBids[0]?.bidderId ?? null,
        secondBidderId: topBids[1]?.bidderId ?? null,
        thirdBidderId: topBids[2]?.bidderId ?? null,
      },
    });
    return topBids;
  }

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
        include: { listing: { select: { authorId: true } } },
      });

      if (!auction) throw new NotFoundException('مزایده یافت نشد');
      if (auction.status !== AuctionStatus.ACTIVE) {
        throw new ForbiddenException('مزایده فعال نیست');
      }
      if (new Date() >= auction.endDatetime) {
        throw new ForbiddenException('زمان مزایده تمام شده است');
      }
      if (auction.listing.authorId === userId) {
        throw new ForbiddenException('ثبت پیشنهاد روی آگهی خودتان مجاز نیست');
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

      const depositPercent = await this.getAuctionDepositPercent(tx, listingId);
      const depositAmount = bidAmount
        .mul(depositPercent)
        .div(100)
        .toDecimalPlaces(0, Decimal.ROUND_CEIL);

      if (depositAmount.lte(0)) {
        throw new BadRequestException('خطا در محاسبه ودیعه (مبلغ نامعتبر)');
      }

      const myCurrentActiveBid = await tx.auctionBid.findFirst({
        where: { listingId, bidderId: userId, status: AuctionBidStatus.ACTIVE },
        orderBy: { amount: 'desc' },
      });
      const alreadyBlocked = new Decimal(myCurrentActiveBid?.blockedAmount ?? 0);
      const diff = depositAmount.minus(alreadyBlocked);
      if (diff.gt(0)) {
        await this.walletService.blockAmount(userId, diff, listingId, tx);
      } else if (diff.lt(0)) {
        await this.walletService.unblockAmount(userId, diff.abs(), listingId, tx);
      }
      if (myCurrentActiveBid) {
        await tx.auctionBid.update({
          where: { id: myCurrentActiveBid.id },
          data: { status: AuctionBidStatus.OUTBID, blockedAmount: 0 },
        });
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

      const { topBids, activeBids } = await this.getTopActiveBids(tx, listingId);
      const topIds = new Set(topBids.map((b: any) => b.id));
      for (const bid of activeBids) {
        if (topIds.has(bid.id)) continue;
        const blocked = new Decimal(bid.blockedAmount ?? 0);
        if (blocked.gt(0)) {
          await this.walletService.unblockAmount(bid.bidderId, blocked, listingId, tx);
        }
        await tx.auctionBid.update({
          where: { id: bid.id },
          data: { status: AuctionBidStatus.OUTBID, blockedAmount: 0 },
        });
      }

      const now = new Date();
      const remaining = auction.endDatetime.getTime() - now.getTime();
      const shouldExtend =
        remaining > 0 && remaining <= LAST_MINUTE_EXTENSION_MINUTES * 60_000;
      await tx.listingAuction.update({
        where: { listingId },
        data: {
          highestBidAmount: topBids[0]?.amount ?? bidAmount,
          highestBidderId: topBids[0]?.bidderId ?? userId,
          secondBidderId: topBids[1]?.bidderId ?? null,
          thirdBidderId: topBids[2]?.bidderId ?? null,
          ...(shouldExtend
            ? {
                endDatetime: new Date(
                  auction.endDatetime.getTime() +
                    LAST_MINUTE_EXTENSION_MINUTES * 60_000,
                ),
              }
            : {}),
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

      if (!auction) throw new NotFoundException('مزایده یافت نشد');
      if (auction.status === AuctionStatus.FINISHED) return null;

      const topBids = await this.syncAuctionRanking(tx, listingId);
      if (!topBids[0]?.bidderId) {
        await tx.listingAuction.update({
          where: { listingId },
          data: {
            status: AuctionStatus.FINISHED,
            settlementStatus: AuctionSettlementStatus.FAILED,
            finishedAt: new Date(),
          },
        });
        return { winner: null };
      }

      const deadlineHours = await this.getWinnerPaymentDeadlineHours(tx);
      await tx.listingAuction.update({
        where: { listingId },
        data: {
          status: AuctionStatus.FINISHED,
          settlementStatus: AuctionSettlementStatus.PENDING,
          paymentDeadline: new Date(Date.now() + deadlineHours * 60 * 60 * 1000),
          finishedAt: new Date(),
        },
      });

      return {
        winnerUserId: topBids[0].bidderId,
        amount: topBids[0].amount,
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

      if (!auction) throw new NotFoundException('مزایده یافت نشد');

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
      if (!winnerBid) {
        throw new BadRequestException('پیشنهاد فعال برنده برای تسویه یافت نشد');
      }

      const totalAmount = new Decimal(auction.highestBidAmount!);
      const blockedDeposit = new Decimal(winnerBid.blockedAmount || 0);

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

      const activeOtherBids = await tx.auctionBid.findMany({
        where: {
          listingId,
          status: AuctionBidStatus.ACTIVE,
          bidderId: { not: payerId },
        },
      });
      for (const otherBid of activeOtherBids) {
        const blocked = new Decimal(otherBid.blockedAmount ?? 0);
        if (blocked.gt(0)) {
          await this.walletService.unblockAmount(
            otherBid.bidderId,
            blocked,
            listingId,
            tx,
          );
        }
        await tx.auctionBid.update({
          where: { id: otherBid.id },
          data: { status: AuctionBidStatus.LOST, blockedAmount: 0 },
        });
      }

      await tx.listingAuction.update({
        where: { listingId },
        data: {
          settlementStatus: AuctionSettlementStatus.PAID,
        },
      });

      await tx.auctionBid.update({
        where: { id: winnerBid.id },
        data: { status: AuctionBidStatus.WON, blockedAmount: 0 },
      });

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
      if (!auction) return;

      const currentWinnerBid = auction.highestBidderId
        ? await tx.auctionBid.findFirst({
            where: {
              listingId,
              bidderId: auction.highestBidderId,
              status: AuctionBidStatus.ACTIVE,
            },
            orderBy: { amount: 'desc' },
          })
        : null;

      if (currentWinnerBid) {
        const blocked = new Decimal(currentWinnerBid.blockedAmount ?? 0);
        if (blocked.gt(0)) {
          await this.walletService.confiscateBlocked(
            currentWinnerBid.bidderId,
            blocked,
            listingId,
            tx,
          );
        }
        await tx.auctionBid.update({
          where: { id: currentWinnerBid.id },
          data: { status: AuctionBidStatus.LOST, blockedAmount: 0 },
        });
      }

      const topBids = await this.syncAuctionRanking(tx, listingId);
      const nextWinner = topBids[0];
      if (!nextWinner) {
        const leftovers = await tx.auctionBid.findMany({
          where: { listingId, status: AuctionBidStatus.ACTIVE },
        });
        for (const bid of leftovers) {
          const blocked = new Decimal(bid.blockedAmount ?? 0);
          if (blocked.gt(0)) {
            await this.walletService.unblockAmount(bid.bidderId, blocked, listingId, tx);
          }
          await tx.auctionBid.update({
            where: { id: bid.id },
            data: { status: AuctionBidStatus.LOST, blockedAmount: 0 },
          });
        }
        await tx.listingAuction.update({
          where: { listingId },
          data: { settlementStatus: AuctionSettlementStatus.FAILED, paymentDeadline: null },
        });
        return;
      }

      const deadlineHours = await this.getWinnerPaymentDeadlineHours(tx);
      await tx.listingAuction.update({
        where: { listingId },
        data: {
          highestBidAmount: nextWinner.amount,
          highestBidderId: nextWinner.bidderId,
          secondBidderId: topBids[1]?.bidderId ?? null,
          thirdBidderId: topBids[2]?.bidderId ?? null,
          paymentDeadline: new Date(Date.now() + deadlineHours * 60 * 60 * 1000),
          settlementStatus: AuctionSettlementStatus.PENDING,
        },
      });
    });
  }

  async cancelBid(userId: string, listingId: string) {
    return this.prisma.$transaction(async (tx) => {
      const auction = await tx.listingAuction.findUnique({ where: { listingId } });
      if (!auction) throw new NotFoundException('مزایده یافت نشد');
      if (auction.status !== AuctionStatus.ACTIVE) {
        throw new BadRequestException('فقط در مزایده فعال امکان انصراف وجود دارد');
      }

      const lockWindowMs = BID_CANCEL_LOCK_HOURS * 60 * 60 * 1000;
      if (auction.endDatetime.getTime() - Date.now() <= lockWindowMs) {
        throw new BadRequestException('تا ۱۲ ساعت مانده به پایان مزایده امکان انصراف وجود ندارد');
      }

      const bid = await tx.auctionBid.findFirst({
        where: { listingId, bidderId: userId, status: AuctionBidStatus.ACTIVE },
        orderBy: { amount: 'desc' },
      });
      if (!bid) throw new BadRequestException('پیشنهاد فعال برای انصراف یافت نشد');

      const blocked = new Decimal(bid.blockedAmount ?? 0);
      if (blocked.gt(0)) {
        await this.walletService.unblockAmount(userId, blocked, listingId, tx);
      }
      await tx.auctionBid.update({
        where: { id: bid.id },
        data: { status: AuctionBidStatus.CANCELLED, blockedAmount: 0 },
      });

      await this.syncAuctionRanking(tx, listingId);
      return { ok: true, message: 'پیشنهاد شما با موفقیت لغو شد' };
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

      if (!auction) throw new NotFoundException('مزایده یافت نشد');
      if (auction.status !== AuctionStatus.ACTIVE)
        throw new ForbiddenException('مزایده فعال نیست');
      if (!auction.buyNowEnabled || !auction.buyNowPrice)
        throw new BadRequestException('خرید فوری برای این مزایده فعال نیست');

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
    const isHighestBidder = !!viewerUserId && viewerUserId === auction.highestBidderId;
    // ID برندگان فقط به خود کاربر (اگر برنده/دومه) و مالک آگهی نمایش داده میشه.
    // برای کاربران عمومی، فقط اطلاع از وجود/مبلغ میدیم نه هویت.
    return {
      listingId,
      title: auction.listing.title,
      auctionStatus: auction.status,
      basePrice: auction.basePrice,
      highestBid: auction.highestBidAmount,
      highestBidderId: isOwner || isHighestBidder ? auction.highestBidderId : null,
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
    const isOwner = !!auction && !!viewerUserId && auction.listing.authorId === viewerUserId;

    const rows = await this.prisma.auctionBid.findMany({
      where: { listingId },
      orderBy: { createdAt: 'desc' },
      take: 50,
      select: {
        amount: true,
        bidderId: true,
        createdAt: true,
        status: true,
        bidder: { select: { firstName: true, lastName: true, avatar: true } },
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
        firstName: b.bidder?.firstName ?? null,
        // نمایش مخفف نام خانوادگی برای رعایت حریم خصوصی.
        lastName: b.bidder?.lastName ? `${b.bidder.lastName.charAt(0)}.` : null,
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
        author: { select: { id: true, firstName: true, lastName: true } },
      },
    });

    if (!listing || !listing.auction) {
      throw new NotFoundException('آگهی مزایده یافت نشد');
    }

    const userBid = listing.auction.bids[0];
    if (!userBid) {
      throw new ForbiddenException('شما هیچ پیشنهادی در این مزایده ندارید');
    }

    const bidAmount = new Decimal(userBid.amount);
    const depositPercent = await this.getAuctionDepositPercent(this.prisma, listingId);
    const blockedAmount = bidAmount
      .mul(depositPercent)
      .div(100)
      .toDecimalPlaces(0, Decimal.ROUND_CEIL);
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
      if (!auction) throw new NotFoundException('مزایده یافت نشد');

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