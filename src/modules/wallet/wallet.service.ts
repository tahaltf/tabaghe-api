import { BadRequestException, Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import {
    WalletTransactionType,
    WalletTransactionStatus,
} from '@prisma/client';
import Decimal from 'decimal.js';

@Injectable()
export class WalletService {
    constructor(private readonly prisma: PrismaService) {}

    async createWalletForUser(userId: string) {
        return this.prisma.wallet.create({
            data: { userId },
        });
    }

    async getWalletByUserId(userId: string) {
        const wallet = await this.prisma.wallet.findUnique({
            where: { userId },
        });

        if (!wallet) {
            throw new BadRequestException('Wallet not found');
        }

        return wallet;
    }

    async blockAmount(
        userId: string,
        amount: Decimal,
        meta?: Record<string, any>,
    ) {
        if (amount.lte(0)) {
            throw new BadRequestException('Invalid amount');
        }

        return this.prisma.$transaction(async (tx) => {
            const result = await tx.wallet.updateMany({
                where: {
                    userId,
                    balanceAvailable: {
                        gte: amount,
                    },
                },
                data: {
                    balanceAvailable: {
                        decrement: amount,
                    },
                    balanceBlocked: {
                        increment: amount,
                    },
                },
            });

            if (result.count !== 1) {
                throw new BadRequestException('Insufficient balance');
            }

            const wallet = await tx.wallet.findUnique({
                where: { userId },
            });

            await tx.walletTransaction.create({
                data: {
                    walletId: wallet!.id,
                    type: WalletTransactionType.BLOCK,
                    amount,
                    status: WalletTransactionStatus.CONFIRMED,
                    meta,
                },
            });

            return true;
        });
    }

    async unblockAmount(
        userId: string,
        amount: Decimal,
        meta?: Record<string, any>,
    ) {
        return this.prisma.$transaction(async (tx) => {
            const result = await tx.wallet.updateMany({
                where: {
                    userId,
                    balanceBlocked: {
                        gte: amount,
                    },
                },
                data: {
                    balanceAvailable: {
                        increment: amount,
                    },
                    balanceBlocked: {
                        decrement: amount,
                    },
                },
            });

            if (result.count !== 1) {
                throw new BadRequestException('Invalid unblock amount');
            }

            const wallet = await tx.wallet.findUnique({
                where: { userId },
            });

            await tx.walletTransaction.create({
                data: {
                    walletId: wallet!.id,
                    type: WalletTransactionType.UNBLOCK,
                    amount,
                    status: WalletTransactionStatus.CONFIRMED,
                    meta,
                },
            });

            return true;
        });
    }

    async settleBlockedAmount(
        userId: string,
        amount: Decimal,
        meta?: Record<string, any>,
    ) {
        return this.prisma.$transaction(async (tx) => {
            const result = await tx.wallet.updateMany({
                where: {
                    userId,
                    balanceBlocked: {
                        gte: amount,
                    },
                },
                data: {
                    balanceBlocked: {
                        decrement: amount,
                    },
                },
            });

            if (result.count !== 1) {
                throw new BadRequestException('Invalid settlement amount');
            }

            const wallet = await tx.wallet.findUnique({
                where: { userId },
            });

            await tx.walletTransaction.create({
                data: {
                    walletId: wallet!.id,
                    type: WalletTransactionType.SETTLEMENT,
                    amount,
                    status: WalletTransactionStatus.CONFIRMED,
                    meta,
                },
            });

            return true;
        });
    }
}
