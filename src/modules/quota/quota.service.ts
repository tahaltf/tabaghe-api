import {
    ForbiddenException,
    Injectable,
} from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import {
    ListingType,
    QuotaAction,
    QuotaReason,
} from '@prisma/client';

@Injectable()
export class QuotaService {
    constructor(private prisma: PrismaService) {}

    // -----------------------------
    // Public API (used by Listing)
    // -----------------------------

    async consumeOnCreate(
        userId: string,
        listingType: ListingType,
        listingId: string,
    ) {
        if (listingType === ListingType.DIRECT) {
            const freeLeft = await this.getRemainingFreeDirect(userId);
            if (freeLeft > 0) {
                return this.commitFreeDirect(userId, listingType, listingId);
            }
        }

        return this.consumeFromPlan(userId, listingType, listingId);
    }

    async releaseOnReject(listingId: string) {
        const ledger = await this.prisma.quotaLedger.findFirst({
            where: {
                listingId,
                action: QuotaAction.COMMIT,
            },
        });

        if (!ledger) return;

        await this.prisma.quotaLedger.create({
            data: {
                userId: ledger.userId,
                listingId,
                listingType: ledger.listingType,
                action: QuotaAction.RELEASE,
                reason: ledger.reason,
                planPurchaseId: ledger.planPurchaseId,
                note: 'Released due to admin rejection',
            },
        });
    }

    // -----------------------------
    // Free DIRECT quota
    // -----------------------------

    private async getRemainingFreeDirect(userId: string): Promise<number> {
        const setting = await this.prisma.appSetting.findUnique({
            where: { key: 'FREE_DIRECT_QUOTA' },
        });

        const freeLimit = Number(setting?.value ?? 2);

        const used = await this.prisma.quotaLedger.count({
            where: {
                userId,
                listingType: ListingType.DIRECT,
                reason: QuotaReason.FREE_DIRECT,
                action: QuotaAction.COMMIT,
            },
        });

        return Math.max(0, freeLimit - used);
    }

    private async commitFreeDirect(
        userId: string,
        listingType: ListingType,
        listingId: string,
    ) {
        return this.prisma.quotaLedger.create({
            data: {
                userId,
                listingId,
                listingType,
                action: QuotaAction.COMMIT,
                reason: QuotaReason.FREE_DIRECT,
                note: 'Free direct listing quota',
            },
        });
    }

    // -----------------------------
    // Plan quota
    // -----------------------------

    private async consumeFromPlan(
        userId: string,
        listingType: ListingType,
        listingId: string,
    ) {
        const purchases = await this.prisma.userPlanPurchase.findMany({
            where: {
                userId,
                status: 'ACTIVE',
            },
            include: {
                plan: {
                    include: {
                        rules: true,
                    },
                },
            },
            orderBy: {
                createdAt: 'asc',
            },
        });

        for (const purchase of purchases) {
            const rule = purchase.plan.rules.find(
                (r) => r.type === listingType,
            );
            if (!rule) continue;

            const used = await this.prisma.quotaLedger.count({
                where: {
                    planPurchaseId: purchase.id,
                    listingType,
                    action: QuotaAction.COMMIT,
                },
            });

            if (used < rule.count) {
                return this.prisma.quotaLedger.create({
                    data: {
                        userId,
                        listingId,
                        listingType,
                        action: QuotaAction.COMMIT,
                        reason: QuotaReason.PLAN,
                        planPurchaseId: purchase.id,
                        note: 'Consumed from plan',
                    },
                });
            }
        }

        throw new ForbiddenException('No quota available for this listing type');
    }
}
