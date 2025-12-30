import { ForbiddenException, Injectable } from '@nestjs/common';
import { ListingType, Prisma, QuotaAction, QuotaReason } from '@prisma/client';

@Injectable()
export class QuotaService {
    // ❌ PrismaService دیگر اینجا استفاده نمی‌شود

    // -----------------------------
    // Public API
    // -----------------------------

    async consumeOnCreate(
        userId: string,
        listingType: ListingType,
        listingId: string,
        prisma: Prisma.TransactionClient,
    ) {
        if (listingType === ListingType.DIRECT) {
            const freeLeft = await this.getRemainingFreeDirect(prisma, userId);

            if (freeLeft > 0) {
                await this.commitFreeDirect(prisma, userId, listingType, listingId);
                return;
            }
        }

        await this.consumeFromPlan(prisma, userId, listingType, listingId);
    }

    async releaseOnReject(
        prisma: Prisma.TransactionClient,
        listingId: string,
    ) {
        const ledger = await prisma.quotaLedger.findFirst({
            where: {
                listingId,
                action: QuotaAction.COMMIT,
            },
        });

        if (!ledger) return;

        await prisma.quotaLedger.create({
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

    private async getRemainingFreeDirect(
        prisma: Prisma.TransactionClient,
        userId: string,
    ): Promise<number> {
        const setting = await prisma.appSetting.findUnique({
            where: { key: 'FREE_DIRECT_QUOTA' },
        });

        const freeLimit = Number(setting?.value ?? 2);

        const commits = await prisma.quotaLedger.count({
            where: {
                userId,
                listingType: ListingType.DIRECT,
                reason: QuotaReason.FREE_DIRECT,
                action: QuotaAction.COMMIT,
            },
        });

        const releases = await prisma.quotaLedger.count({
            where: {
                userId,
                listingType: ListingType.DIRECT,
                reason: QuotaReason.FREE_DIRECT,
                action: QuotaAction.RELEASE,
            },
        });

        const used = commits - releases;
        return Math.max(0, freeLimit - used);
    }

    private async commitFreeDirect(
        prisma: Prisma.TransactionClient,
        userId: string,
        listingType: ListingType,
        listingId: string,
    ) {
        await prisma.quotaLedger.create({
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
        prisma: Prisma.TransactionClient,
        userId: string,
        listingType: ListingType,
        listingId: string,
    ) {
        const purchases = await prisma.userPlanPurchase.findMany({
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

            const used = await prisma.quotaLedger.count({
                where: {
                    planPurchaseId: purchase.id,
                    listingType,
                    action: QuotaAction.COMMIT,
                },
            });

            if (used < rule.count) {
                await prisma.quotaLedger.create({
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
                return;
            }
        }

        throw new ForbiddenException('No quota available for this listing type');
    }
}
