// src/modules/plans/plans.service.ts

import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { WalletService } from '../wallet/wallet.service';

@Injectable()
export class PlansService {
    constructor(
        private readonly prisma: PrismaService,
        private readonly walletService: WalletService,
    ) {}

    // -----------------------------------
    // Public: Get active plans
    // -----------------------------------
    async getActivePlans() {
        return this.prisma.plan.findMany({
            where: { isActive: true },
            include: { rules: true },
            orderBy: { createdAt: 'asc' },
        });
    }

    // -----------------------------------
    // User: Buy plan (wallet settlement)
    // -----------------------------------
    async buyPlan(userId: string, planId: string) {
        const plan = await this.prisma.plan.findUnique({
            where: { id: planId },
        });

        if (!plan || !plan.isActive) {
            throw new NotFoundException('Plan not available');
        }

        return this.prisma.$transaction(async (tx) => {
            // 💰 پرداخت مستقیم از موجودی کیف پول
            await this.walletService.payFromAvailable(
                userId,
                plan.price,
                {
                    type: 'BUY_PLAN',
                    planId: plan.id,
                    title: plan.title,
                },
            );

            return tx.userPlanPurchase.create({
                data: {
                    userId,
                    planId,
                    status: 'ACTIVE',
                },
            });
        });
    }

    // -----------------------------------
    // Helper: get user active plans
    // -----------------------------------
    async getUserActivePlans(userId: string) {
        return this.prisma.userPlanPurchase.findMany({
            where: {
                userId,
                status: 'ACTIVE',
            },
            include: {
                plan: {
                    include: { rules: true },
                },
            },
            orderBy: { createdAt: 'asc' },
        });
    }
}
