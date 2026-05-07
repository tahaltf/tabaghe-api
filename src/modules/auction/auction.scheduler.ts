import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { AuctionService } from './auction.service';
import { AuctionSettlementStatus, AuctionStatus, NotificationType, UserRole } from '@prisma/client';
import { Prisma } from '@prisma/client';
import Decimal from 'decimal.js';

type AuctionHealthState = 'ok' | 'warning' | 'critical';

@Injectable()
export class AuctionScheduler {
    private readonly logger = new Logger(AuctionScheduler.name);
    private readonly HEALTH_STATE_KEY = 'AUCTION_HEALTH_LAST_STATE';
    private readonly HEALTH_LAST_ALERT_AT_KEY = 'AUCTION_HEALTH_LAST_ALERT_AT';
    private readonly RECON_LAST_REPORT_KEY = 'AUCTION_RECON_LAST_REPORT';
    private readonly DEFAULT_LEASE_MS = 45_000;

    constructor(
        private readonly prisma: PrismaService,
        private readonly auctionService: AuctionService,
    ) {}

    /**
     * Runs every minute
     * Penalizes auction winners who missed payment deadline
     */
    @Cron(CronExpression.EVERY_MINUTE)
    async handleAuctionPaymentTimeouts() {
        await this.withLease('AUCTION_JOB_PAYMENT_TIMEOUTS', async () => {
            try {
                await this.auctionService.checkUnpaidAuctions();
            } catch (err) {
                this.logger.error(
                    'Failed to process unpaid auctions',
                    err instanceof Error ? err.stack : undefined,
                );
            }
        });
    }

    /**
     * Runs every minute
     * Expires second-chance offers that passed their window
     */
    @Cron(CronExpression.EVERY_MINUTE)
    async expireSecondChanceOffers() {
        await this.withLease('AUCTION_JOB_EXPIRE_SECOND_CHANCE', async () => {
            const now = new Date();
            try {
                await this.prisma.secondChanceOffer.updateMany({
                    where: {
                        status: 'OFFERED',
                        expiresAt: { lt: now },
                    },
                    data: {
                        status: 'EXPIRED',
                        expiredAt: now,
                    },
                });
            } catch (err) {
                this.logger.error(
                    'Failed to expire second chance offers',
                    err instanceof Error ? err.stack : undefined,
                );
            }
        });
    }

    /**
     * Runs every minute
     * Evaluates auction health and creates edge-triggered admin incidents.
     */
    @Cron(CronExpression.EVERY_MINUTE)
    async evaluateAuctionOperationalHealth() {
        await this.withLease('AUCTION_JOB_HEALTH_EVAL', async () => {
          try {
            const [
                pendingSettlements,
                failedSettlements,
                pendingThreshold,
                failedThreshold,
                cooldownMinutes,
                previousState,
                lastAlertAtRaw,
            ] =
                await Promise.all([
                    this.prisma.listingAuction.count({
                        where: { settlementStatus: AuctionSettlementStatus.PENDING },
                    }),
                    this.prisma.listingAuction.count({
                        where: { settlementStatus: AuctionSettlementStatus.FAILED },
                    }),
                    this.getNumericSetting('AUCTION_ALERT_PENDING_THRESHOLD', 30),
                    this.getNumericSetting('AUCTION_ALERT_FAILED_THRESHOLD', 5),
                    this.getNumericSetting('AUCTION_ALERT_COOLDOWN_MINUTES', 30),
                    this.getStringSetting(this.HEALTH_STATE_KEY, 'ok'),
                    this.getStringSetting(this.HEALTH_LAST_ALERT_AT_KEY, ''),
                ]);

            const nextState = this.resolveHealthState({
                pendingSettlements,
                failedSettlements,
                pendingThreshold,
                failedThreshold,
            });

            if (nextState === previousState) return;

            await this.prisma.systemSetting.upsert({
                where: { key: this.HEALTH_STATE_KEY },
                update: { value: nextState, description: 'Last computed auction health state' },
                create: {
                    key: this.HEALTH_STATE_KEY,
                    value: nextState,
                    description: 'Last computed auction health state',
                },
            });

            // Alert only on degradation or escalation (ok->warning/critical, warning->critical).
            const shouldAlert =
                (previousState === 'ok' && (nextState === 'warning' || nextState === 'critical')) ||
                (previousState === 'warning' && nextState === 'critical');
            if (!shouldAlert) return;

            const now = new Date();
            const lastAlertAt = lastAlertAtRaw ? new Date(lastAlertAtRaw) : null;
            const cooldownMs = Math.max(1, cooldownMinutes) * 60 * 1000;
            if (lastAlertAt && Number.isFinite(lastAlertAt.getTime())) {
                const elapsed = now.getTime() - lastAlertAt.getTime();
                if (elapsed >= 0 && elapsed < cooldownMs) {
                    return;
                }
            }

            // Cross-worker dedup guard: only one alert per state+cooldown bucket.
            const cooldownBucket = Math.floor(now.getTime() / cooldownMs);
            const dedupKey = `AUCTION_HEALTH_DEDUP_${nextState.toUpperCase()}_${cooldownBucket}`;
            try {
                await this.prisma.systemSetting.create({
                    data: {
                        key: dedupKey,
                        value: now.toISOString(),
                        description: 'Auction health dedup lock key',
                    },
                });
            } catch (err) {
                if (
                    err instanceof Prisma.PrismaClientKnownRequestError &&
                    err.code === 'P2002'
                ) {
                    return;
                }
                throw err;
            }

            const admins = await this.prisma.user.findMany({
                where: { role: UserRole.ADMIN },
                select: { id: true },
            });
            if (!admins.length) return;

            const title = `[AUCTION_HEALTH] ${nextState.toUpperCase()}`;
            const message = `وضعیت سلامت مزایده از ${previousState.toUpperCase()} به ${nextState.toUpperCase()} تغییر کرد. در انتظار: ${pendingSettlements} (threshold=${pendingThreshold}) | ناموفق: ${failedSettlements} (threshold=${failedThreshold})`;
            await this.prisma.notification.createMany({
                data: admins.map((admin) => ({
                    userId: admin.id,
                    type: NotificationType.SYSTEM,
                    title,
                    message,
                    meta: {
                        event: 'AUCTION_HEALTH_STATE_CHANGED',
                        from: previousState,
                        to: nextState,
                        pendingSettlements,
                        failedSettlements,
                        pendingThreshold,
                        failedThreshold,
                    },
                    createdAt: now,
                })),
            });

            await this.prisma.systemSetting.upsert({
                where: { key: this.HEALTH_LAST_ALERT_AT_KEY },
                update: { value: now.toISOString(), description: 'Last auction health alert timestamp' },
                create: {
                    key: this.HEALTH_LAST_ALERT_AT_KEY,
                    value: now.toISOString(),
                    description: 'Last auction health alert timestamp',
                },
            });
          } catch (err) {
              this.logger.error(
                  'Failed to evaluate auction operational health',
                  err instanceof Error ? err.stack : undefined,
              );
          }
        });
    }

    private resolveHealthState(input: {
        pendingSettlements: number;
        failedSettlements: number;
        pendingThreshold: number;
        failedThreshold: number;
    }): AuctionHealthState {
        const { pendingSettlements, failedSettlements, pendingThreshold, failedThreshold } = input;
        if (failedSettlements >= failedThreshold || pendingSettlements >= pendingThreshold * 2) {
            return 'critical';
        }
        if (failedSettlements > 0 || pendingSettlements >= pendingThreshold) {
            return 'warning';
        }
        return 'ok';
    }

    private async getNumericSetting(key: string, fallback: number): Promise<number> {
        const row = await this.prisma.systemSetting.findUnique({
            where: { key },
            select: { value: true },
        });
        const num = Number(row?.value ?? '');
        return Number.isFinite(num) && num > 0 ? num : fallback;
    }

    private async getStringSetting(key: string, fallback: string): Promise<string> {
        const row = await this.prisma.systemSetting.findUnique({
            where: { key },
            select: { value: true },
        });
        const value = row?.value?.trim();
        return value ? value : fallback;
    }

    /**
     * Runs every day at 02:10
     * Reconciles auction financial ledger and emits incident on mismatches.
     */
    @Cron('10 2 * * *')
    async runDailyAuctionLedgerReconciliation() {
        await this.withLease('AUCTION_JOB_RECON_DAILY', async () => {
            await this.runAuctionLedgerReconciliation();
        });
    }

    async runAuctionLedgerReconciliation() {
        const now = new Date();
        const since24h = new Date(now.getTime() - 24 * 60 * 60 * 1000);
        const paidAuctions = await this.prisma.listingAuction.findMany({
            where: {
                settlementStatus: AuctionSettlementStatus.PAID,
                finishedAt: { gte: since24h },
            },
            select: {
                listingId: true,
                highestBidAmount: true,
                bids: {
                    where: { status: 'WON' },
                    select: { blockedAmount: true },
                    take: 1,
                },
                listing: {
                    select: {
                        order: {
                            select: {
                                finalPrice: true,
                                platformFee: true,
                                sellerRevenue: true,
                            },
                        },
                    },
                },
            },
        });

        const mismatches: Array<{
            listingId: string;
            reason: string;
            expected: number;
            actual: number;
        }> = [];

        for (const row of paidAuctions) {
            const winnerDeposit = new Decimal(row.bids?.[0]?.blockedAmount ?? 0);
            const finalPrice = new Decimal(row.listing.order?.finalPrice ?? row.highestBidAmount ?? 0);
            const payableRemainder = Decimal.max(finalPrice.minus(winnerDeposit), new Decimal(0));

            const txs = await this.prisma.walletTransaction.findMany({
                where: { referenceId: row.listingId, type: 'SETTLEMENT', status: 'SUCCESS' },
                select: { amount: true },
            });
            const settlementSum = txs.reduce((acc, tx) => acc.plus(tx.amount ?? 0), new Decimal(0));

            // Conservative check: settlement cash should at least cover winner out-of-pocket remainder.
            if (settlementSum.lessThan(payableRemainder)) {
                mismatches.push({
                    listingId: row.listingId,
                    reason: 'SETTLEMENT_LT_PAYABLE_REMAINDER',
                    expected: payableRemainder.toNumber(),
                    actual: settlementSum.toNumber(),
                });
            }

            const order = row.listing.order;
            if (order) {
                const feePlusSeller = new Decimal(order.platformFee ?? 0).plus(order.sellerRevenue ?? 0);
                const totalOrder = new Decimal(order.finalPrice ?? 0);
                if (!feePlusSeller.equals(totalOrder)) {
                    mismatches.push({
                        listingId: row.listingId,
                        reason: 'ORDER_SPLIT_MISMATCH',
                        expected: totalOrder.toNumber(),
                        actual: feePlusSeller.toNumber(),
                    });
                }
            }
        }

        const report = {
            createdAt: now.toISOString(),
            windowStart: since24h.toISOString(),
            checkedAuctions: paidAuctions.length,
            mismatchCount: mismatches.length,
            mismatches: mismatches.slice(0, 200),
        };

        await this.prisma.systemSetting.upsert({
            where: { key: this.RECON_LAST_REPORT_KEY },
            update: {
                value: JSON.stringify(report),
                description: 'Latest auction ledger reconciliation report',
            },
            create: {
                key: this.RECON_LAST_REPORT_KEY,
                value: JSON.stringify(report),
                description: 'Latest auction ledger reconciliation report',
            },
        });

        if (!mismatches.length) return report;

        const admins = await this.prisma.user.findMany({
            where: { role: UserRole.ADMIN },
            select: { id: true },
        });
        if (admins.length) {
            await this.prisma.notification.createMany({
                data: admins.map((a) => ({
                    userId: a.id,
                    type: NotificationType.SYSTEM,
                    title: '[AUCTION_RECON] MISMATCH_DETECTED',
                    message: `گزارش Reconciliation مزایده: ${mismatches.length} اختلاف در 24 ساعت اخیر شناسایی شد.`,
                    meta: {
                        event: 'AUCTION_RECON_MISMATCH',
                        mismatchCount: mismatches.length,
                        checkedAuctions: paidAuctions.length,
                    },
                })),
            });
        }

        return report;
    }

    @Cron('20 3 * * *')
    async cleanupAuctionOperationalKeys() {
        await this.withLease('AUCTION_JOB_CLEANUP_OP_KEYS', async () => {
            // cleanup best-effort keys to avoid unbounded growth
            await this.prisma.systemSetting.deleteMany({
                where: {
                    key: {
                        startsWith: 'AUCTION_HEALTH_DEDUP_',
                    },
                },
            });
            await this.prisma.systemSetting.deleteMany({
                where: {
                    key: {
                        startsWith: 'AUCTION_ADMIN_ACTION_',
                    },
                },
            });
        });
    }

    private async withLease(key: string, task: () => Promise<void>) {
        const leaseKey = `AUCTION_LEASE_${key}`;
        const now = Date.now();
        const owner = `${process.pid}-${now}`;
        const expiresAt = now + this.DEFAULT_LEASE_MS;
        const current = await this.prisma.systemSetting.findUnique({
            where: { key: leaseKey },
            select: { value: true },
        });
        if (current?.value) {
            try {
                const parsed = JSON.parse(current.value) as { expiresAt?: number };
                if ((parsed?.expiresAt ?? 0) > now) return;
            } catch {
                // ignore malformed lease and replace it
            }
        }
        await this.prisma.systemSetting.upsert({
            where: { key: leaseKey },
            update: { value: JSON.stringify({ owner, expiresAt }) },
            create: {
                key: leaseKey,
                value: JSON.stringify({ owner, expiresAt }),
                description: 'Auction scheduler lease key',
            },
        });
        try {
            await task();
        } finally {
            const check = await this.prisma.systemSetting.findUnique({
                where: { key: leaseKey },
                select: { value: true },
            });
            let parsed: any = null;
            try {
                parsed = check?.value ? JSON.parse(check.value) : null;
            } catch {
                parsed = null;
            }
            if (parsed?.owner === owner) {
                await this.prisma.systemSetting.deleteMany({ where: { key: leaseKey } });
            }
        }
    }
}
