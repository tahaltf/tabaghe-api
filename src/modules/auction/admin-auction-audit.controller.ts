import {
    Controller,
    DefaultValuePipe,
    Get,
    Body,
    NotFoundException,
    Param,
    Patch,
    ParseIntPipe,
    Post,
    Query,
    Req,
    UseGuards,
} from '@nestjs/common';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { AuctionScheduler } from './auction.scheduler';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { AuctionSettlementStatus, AuctionStatus, NotificationType, OrderType, UserRole } from '@prisma/client';
import Decimal from 'decimal.js';
import { readRecentJsonLogs } from '../../common/logging/app-log.util';

@Controller('admin/auctions')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(UserRole.ADMIN)
export class AdminAuctionAuditController {
    constructor(
        private readonly prisma: PrismaService,
        private readonly auctionScheduler: AuctionScheduler,
    ) {}

    @Get('incidents')
    async getAuctionHealthIncidents(
        @Query('limit', new DefaultValuePipe(50), ParseIntPipe) limit: number,
    ) {
        const take = Math.max(1, Math.min(200, limit));
        const rows = await this.prisma.notification.findMany({
            where: {
                type: NotificationType.SYSTEM,
                title: { startsWith: '[AUCTION_HEALTH]' },
            },
            orderBy: { createdAt: 'desc' },
            take,
            select: {
                id: true,
                userId: true,
                title: true,
                message: true,
                meta: true,
                isRead: true,
                createdAt: true,
            },
        });
        const stateKeys = rows.map((r) => `AUCTION_INCIDENT_STATE_${r.id}`);
        const states = stateKeys.length
          ? await this.prisma.systemSetting.findMany({
              where: { key: { in: stateKeys } },
              select: { key: true, value: true },
            })
          : [];
        const stateMap = new Map<string, any>();
        for (const s of states) {
          try {
            stateMap.set(s.key, JSON.parse(s.value));
          } catch {
            stateMap.set(s.key, null);
          }
        }
        return {
            items: rows.map((row) => ({
              ...row,
              workflow: stateMap.get(`AUCTION_INCIDENT_STATE_${row.id}`) ?? null,
            })),
            count: rows.length,
        };
    }

    @Patch('incidents/:id/assign')
    async assignAuctionIncident(
      @Param('id') id: string,
      @Req() req: any,
      @Body() body: { ownerId?: string; slaMinutes?: number },
    ) {
      const adminId = req?.user?.sub ?? req?.user?.id;
      const ownerId = body?.ownerId || adminId;
      const slaMinutes = Math.max(5, Number(body?.slaMinutes ?? 60));
      const incident = await this.prisma.notification.findUnique({
        where: { id },
        select: { id: true, title: true, type: true },
      });
      if (!incident || incident.type !== NotificationType.SYSTEM || !incident.title.startsWith('[AUCTION_')) {
        throw new NotFoundException('Incident یافت نشد');
      }
      const payload = {
        status: 'ASSIGNED',
        ownerId,
        assignedBy: adminId,
        assignedAt: new Date().toISOString(),
        slaDueAt: new Date(Date.now() + slaMinutes * 60 * 1000).toISOString(),
      };
      await this.prisma.systemSetting.upsert({
        where: { key: `AUCTION_INCIDENT_STATE_${id}` },
        update: { value: JSON.stringify(payload), description: 'Auction incident workflow state' },
        create: {
          key: `AUCTION_INCIDENT_STATE_${id}`,
          value: JSON.stringify(payload),
          description: 'Auction incident workflow state',
        },
      });
      return { ok: true, workflow: payload };
    }

    @Patch('incidents/:id/resolve')
    async resolveAuctionIncident(
      @Param('id') id: string,
      @Req() req: any,
      @Body() body: { resolutionNote?: string },
    ) {
      const adminId = req?.user?.sub ?? req?.user?.id;
      const key = `AUCTION_INCIDENT_STATE_${id}`;
      const row = await this.prisma.systemSetting.findUnique({
        where: { key },
        select: { value: true },
      });
      let prev: any = null;
      try {
        prev = row?.value ? JSON.parse(row.value) : null;
      } catch {
        prev = null;
      }
      const workflow = {
        ...(prev || {}),
        status: 'RESOLVED',
        resolvedBy: adminId,
        resolvedAt: new Date().toISOString(),
        resolutionNote: body?.resolutionNote ?? '',
      };
      await this.prisma.systemSetting.upsert({
        where: { key },
        update: { value: JSON.stringify(workflow), description: 'Auction incident workflow state' },
        create: { key, value: JSON.stringify(workflow), description: 'Auction incident workflow state' },
      });
      return { ok: true, workflow };
    }

    @Patch('incidents/:id/ack')
    async acknowledgeAuctionHealthIncident(@Param('id') id: string, @Req() req: any) {
        const adminId = req?.user?.sub ?? req?.user?.id;
        if (!adminId) {
            throw new NotFoundException('کاربر ادمین معتبر یافت نشد');
        }
        const updated = await this.prisma.notification.updateMany({
            where: {
                id,
                userId: adminId,
                type: NotificationType.SYSTEM,
                title: { startsWith: '[AUCTION_HEALTH]' },
            },
            data: { isRead: true },
        });
        if (!updated.count) {
            throw new NotFoundException('Incident قابل acknowledge یافت نشد');
        }
        return { ok: true };
    }

    @Get('metrics/overview')
    async getAuctionOverviewMetrics() {
        const now = new Date();
        const since7d = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
        const since30d = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);

        const [totalAuctions, activeAuctions, finishedAuctions, paidSettlements, failedSettlements, pendingSettlements, orders7d, orders30d] =
            await Promise.all([
                this.prisma.listingAuction.count(),
                this.prisma.listingAuction.count({ where: { status: AuctionStatus.ACTIVE } }),
                this.prisma.listingAuction.count({ where: { status: AuctionStatus.FINISHED } }),
                this.prisma.listingAuction.count({ where: { settlementStatus: AuctionSettlementStatus.PAID } }),
                this.prisma.listingAuction.count({ where: { settlementStatus: AuctionSettlementStatus.FAILED } }),
                this.prisma.listingAuction.count({ where: { settlementStatus: AuctionSettlementStatus.PENDING } }),
                this.prisma.order.findMany({
                    where: { type: OrderType.AUCTION, createdAt: { gte: since7d } },
                    select: { finalPrice: true, platformFee: true },
                }),
                this.prisma.order.findMany({
                    where: { type: OrderType.AUCTION, createdAt: { gte: since30d } },
                    select: { finalPrice: true, platformFee: true },
                }),
            ]);

        const sum = (rows: Array<{ finalPrice: any; platformFee: any }>) =>
            rows.reduce(
                (acc, row) => ({
                    gmv: acc.gmv.plus(row.finalPrice ?? 0),
                    fee: acc.fee.plus(row.platformFee ?? 0),
                }),
                { gmv: new Decimal(0), fee: new Decimal(0) },
            );

        const weekly = sum(orders7d);
        const monthly = sum(orders30d);

        return {
            timestamp: now.toISOString(),
            auctions: {
                total: totalAuctions,
                active: activeAuctions,
                finished: finishedAuctions,
                settlementPaid: paidSettlements,
                settlementPending: pendingSettlements,
                settlementFailed: failedSettlements,
            },
            kpi7d: {
                ordersCount: orders7d.length,
                gmv: weekly.gmv.toNumber(),
                platformRevenue: weekly.fee.toNumber(),
            },
            kpi30d: {
                ordersCount: orders30d.length,
                gmv: monthly.gmv.toNumber(),
                platformRevenue: monthly.fee.toNumber(),
            },
        };
    }

    @Get('reconciliation/latest')
    async getLatestAuctionReconciliationReport() {
        const row = await this.prisma.systemSetting.findUnique({
            where: { key: 'AUCTION_RECON_LAST_REPORT' },
            select: { value: true, updatedAt: true },
        });
        if (!row?.value) {
            return { exists: false };
        }
        let parsed: unknown = null;
        try {
            parsed = JSON.parse(row.value);
        } catch {
            parsed = null;
        }
        return {
            exists: true,
            updatedAt: row.updatedAt,
            report: parsed,
        };
    }

    @Post('reconciliation/run')
    async runAuctionReconciliationNow() {
        const report = await this.auctionScheduler.runAuctionLedgerReconciliation();
        return { ok: true, report };
    }

    @Get('timeline')
    async getAuctionTimeline(
      @Query('limit', new DefaultValuePipe(200), ParseIntPipe) limit: number,
      @Query('listingId') listingId?: string,
    ) {
      const items = readRecentJsonLogs('auction-timeline.log', Math.max(1, Math.min(1000, limit)));
      return {
        items: listingId
          ? items.filter((i) => String(i?.listingId ?? '') === listingId)
          : items,
      };
    }

    @Get(':listingId/financial')
    async getAuctionFinancial(@Param('listingId') listingId: string) {
        const [auction, order, txns] = await Promise.all([
            this.prisma.listingAuction.findUnique({
            where: { listingId },
            include: {
                listing: {
                    include: {
                        category: {
                            select: {
                                title: true,
                                auctionDepositPercent: true,
                                feePercentageAuction: true,
                                feeCapAuction: true,
                            },
                        },
                    },
                },
                bids: {
                    orderBy: [{ amount: 'desc' }, { createdAt: 'asc' }],
                    select: {
                        id: true,
                        bidderId: true,
                        bidder: {
                            select: {
                                firstName: true,
                                lastName: true,
                                phone: true,
                            },
                        },
                        amount: true,
                        blockedAmount: true,
                        status: true,
                        createdAt: true,
                    },
                },
            },
        }),
            this.prisma.order.findUnique({
                where: { listingId },
                select: {
                    id: true,
                    status: true,
                    type: true,
                    finalPrice: true,
                    totalAmount: true,
                    shippingCost: true,
                    verificationFee: true,
                    platformFee: true,
                    sellerRevenue: true,
                    paymentMethod: true,
                    createdAt: true,
                    updatedAt: true,
                    buyerId: true,
                    sellerId: true,
                },
            }),
            this.prisma.walletTransaction.findMany({
                where: { referenceId: listingId },
                select: {
                    id: true,
                    walletId: true,
                    type: true,
                    status: true,
                    amount: true,
                    createdAt: true,
                },
                orderBy: { createdAt: 'asc' },
            }),
        ]);

        if (!auction) {
            return { exists: false };
        }

        const winnerBid = auction.bids.find((b) => b.status === 'WON')
            ?? auction.bids.find((b) => b.bidderId === auction.highestBidderId)
            ?? null;
        const highestActive = auction.bids.find((b) => b.status === 'ACTIVE') ?? null;
        const finalBidAmount = new Decimal(
            winnerBid?.amount ?? auction.highestBidAmount ?? highestActive?.amount ?? 0,
        );
        const winnerDepositUsed = new Decimal(winnerBid?.blockedAmount ?? 0);

        const shippingCost = new Decimal(order?.shippingCost ?? 0);
        const verificationFee = new Decimal(order?.verificationFee ?? 0);
        const platformFee = new Decimal(order?.platformFee ?? 0);
        const sellerRevenue = new Decimal(order?.sellerRevenue ?? 0);
        const payableRemainder = Decimal.max(
            finalBidAmount.minus(winnerDepositUsed),
            new Decimal(0),
        );

        const totalBlockedAcrossBidders = auction.bids.reduce(
            (acc, b) => acc.plus(b.blockedAmount ?? 0),
            new Decimal(0),
        );

        const txTotals = txns.reduce(
            (acc, t) => {
                const amount = new Decimal(t.amount ?? 0);
                if (t.type === 'BLOCK') acc.block = acc.block.plus(amount);
                if (t.type === 'UNBLOCK') acc.unblock = acc.unblock.plus(amount);
                if (t.type === 'PENALTY') acc.penalty = acc.penalty.plus(amount);
                if (t.type === 'SETTLEMENT') acc.settlement = acc.settlement.plus(amount);
                if (t.type === 'DEPOSIT') acc.deposit = acc.deposit.plus(amount);
                return acc;
            },
            {
                block: new Decimal(0),
                unblock: new Decimal(0),
                penalty: new Decimal(0),
                settlement: new Decimal(0),
                deposit: new Decimal(0),
            },
        );

        return {
            listingId,
            exists: true,
            listing: {
                id: auction.listingId,
                title: auction.listing.title,
                sellerId: auction.listing.authorId,
                categoryTitle: auction.listing.category?.title ?? null,
                categoryAuctionDepositPercent:
                    auction.listing.category?.auctionDepositPercent ?? null,
                categoryAuctionFeePercent:
                    auction.listing.category?.feePercentageAuction ?? null,
                categoryAuctionFeeCap: auction.listing.category?.feeCapAuction ?? null,
            },
            auction: {
                status: auction.status,
                settlementStatus: auction.settlementStatus,
                highestBidderId: auction.highestBidderId,
                highestBidAmount: auction.highestBidAmount,
                basePrice: auction.basePrice,
                minBidIncrement: auction.minBidIncrement,
                endDatetime: auction.endDatetime,
                paymentDeadline: auction.paymentDeadline,
                finishedAt: auction.finishedAt,
                bidsCount: auction.bids.length,
            },
            financialBreakdown: {
                finalBidAmount: finalBidAmount.toNumber(),
                winnerDepositUsed: winnerDepositUsed.toNumber(),
                payableRemainder: payableRemainder.toNumber(),
                shippingCost: shippingCost.toNumber(),
                verificationFee: verificationFee.toNumber(),
                platformFee: platformFee.toNumber(),
                sellerRevenue: sellerRevenue.toNumber(),
                totalBuyerOutOfPocket: payableRemainder.plus(shippingCost).plus(verificationFee).toNumber(),
                totalBlockedAcrossBidders: totalBlockedAcrossBidders.toNumber(),
            },
            order: order
                ? {
                    id: order.id,
                    status: order.status,
                    type: order.type,
                    paymentMethod: order.paymentMethod,
                    buyerId: order.buyerId,
                    sellerId: order.sellerId,
                    createdAt: order.createdAt,
                    updatedAt: order.updatedAt,
                }
                : null,
            bidLedger: auction.bids.map((b) => ({
                id: b.id,
                bidderId: b.bidderId,
                bidderName: `${b.bidder?.firstName ?? ''} ${b.bidder?.lastName ?? ''}`.trim() || null,
                bidderPhone: b.bidder?.phone ? `${String(b.bidder.phone).slice(0, 4)}****` : null,
                amount: Number(b.amount),
                blockedAmount: Number(b.blockedAmount),
                status: b.status,
                createdAt: b.createdAt,
            })),
            walletLedgerSummary: {
                txCount: txns.length,
                block: txTotals.block.toNumber(),
                unblock: txTotals.unblock.toNumber(),
                penalty: txTotals.penalty.toNumber(),
                settlement: txTotals.settlement.toNumber(),
                deposit: txTotals.deposit.toNumber(),
            },
        };
    }
}
