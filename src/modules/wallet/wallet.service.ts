// src/modules/wallet/wallet.service.ts

import {BadRequestException, Injectable} from '@nestjs/common';
import {PrismaService} from '../../prisma/prisma.service';
import {Prisma, WalletTransactionStatus, WalletTransactionType,} from '@prisma/client';
import Decimal from 'decimal.js';

@Injectable()
export class WalletService {
    constructor(private readonly prisma: PrismaService) {}

    // -----------------------------
    // Helpers
    // -----------------------------

    private toDecimal(amount: Decimal | number | string): Decimal {
        const value = new Decimal(amount);
        if (value.lte(0)) {
            throw new BadRequestException('Invalid amount');
        }
        return value;
    }

    private async getOrCreateWallet(
        tx: Prisma.TransactionClient,
        userId: string,
    ) {
        let wallet = await tx.wallet.findUnique({where: {userId}});

        if (!wallet) {
            wallet = await tx.wallet.create({
                data: {userId},
            });
        }

        return wallet;
    }

    // -----------------------------
    // Read
    // -----------------------------

    async getWalletByUserId(userId: string) {
        const wallet = await this.prisma.wallet.findUnique({
            where: { userId },
        });

        if (!wallet) {
            throw new BadRequestException('Wallet not found');
        }

        return wallet;
    }

    // -----------------------------
    // Deposit (fake / gateway later)
    // -----------------------------

    async deposit(
        userId: string,
        amount: Decimal | number,
        meta?: Record<string, any>,
    ) {
        const value = this.toDecimal(amount);

        return this.prisma.$transaction(async (tx) => {
            const wallet = await this.getOrCreateWallet(tx, userId);

            await tx.walletTransaction.create({
                data: {
                    walletId: wallet.id,
                    type: WalletTransactionType.DEPOSIT,
                    amount: value,
                    status: WalletTransactionStatus.CONFIRMED,
                    meta,
                },
            });

            return tx.wallet.update({
                where: {id: wallet.id},
                data: {
                    balanceAvailable: {
                        increment: value,
                    },
                },
            });
        });
    }

    // -----------------------------
    // Block (Auction bid)
    // -----------------------------

    async blockAmount(
        userId: string,
        amount: Decimal | number,
        meta?: Record<string, any>,
    ) {
        const value = this.toDecimal(amount);

        return this.prisma.$transaction(async (tx) => {
            const wallet = await this.getOrCreateWallet(tx, userId);

            const result = await tx.wallet.updateMany({
                where: {
                    id: wallet.id,
                    balanceAvailable: {
                        gte: value,
                    },
                },
                data: {
                    balanceAvailable: {decrement: value},
                    balanceBlocked: {increment: value},
                },
            });

            if (result.count !== 1) {
                throw new BadRequestException('Insufficient balance');
            }

            await tx.walletTransaction.create({
                data: {
                    walletId: wallet.id,
                    type: WalletTransactionType.BLOCK,
                    amount: value,
                    status: WalletTransactionStatus.CONFIRMED,
                    meta,
                },
            });

            return true;
        });
    }

    // -----------------------------
    // Unblock (outbid / cancel)
    // -----------------------------

    async unblockAmount(
        userId: string,
        amount: Decimal | number,
        meta?: Record<string, any>,
    ) {
        const value = this.toDecimal(amount);

        return this.prisma.$transaction(async (tx) => {
            const wallet = await this.getOrCreateWallet(tx, userId);

            const result = await tx.wallet.updateMany({
                where: {
                    id: wallet.id,
                    balanceBlocked: {
                        gte: value,
                    },
                },
                data: {
                    balanceAvailable: {increment: value},
                    balanceBlocked: {decrement: value},
                },
            });

            if (result.count !== 1) {
                throw new BadRequestException('Invalid unblock amount');
            }

            await tx.walletTransaction.create({
                data: {
                    walletId: wallet.id,
                    type: WalletTransactionType.UNBLOCK,
                    amount: value,
                    status: WalletTransactionStatus.CONFIRMED,
                    meta,
                },
            });

            return true;
        });
    }

    // -----------------------------
    // Settlement (winner / buy)
    // -----------------------------

    async settleBlockedAmount(
        userId: string,
        amount: Decimal | number,
        meta?: Record<string, any>,
    ) {
        const value = this.toDecimal(amount);

        return this.prisma.$transaction(async (tx) => {
            const wallet = await this.getOrCreateWallet(tx, userId);

            const result = await tx.wallet.updateMany({
                where: {
                    id: wallet.id,
                    balanceBlocked: {
                        gte: value,
                    },
                },
                data: {
                    balanceBlocked: {decrement: value},
                },
            });

            if (result.count !== 1) {
                throw new BadRequestException('Invalid settlement amount');
            }

            await tx.walletTransaction.create({
                data: {
                    walletId: wallet.id,
                    type: WalletTransactionType.SETTLEMENT,
                    amount: value,
                    status: WalletTransactionStatus.CONFIRMED,
                    meta,
                },
            });

            return true;
        });
    }

    async payFromAvailable(
        userId: string,
        amount: Decimal | number,
        meta?: Record<string, any>,
    ) {
        const value = this.toDecimal(amount);

        return this.prisma.$transaction(async (tx) => {
            const wallet = await this.getOrCreateWallet(tx, userId);

            const result = await tx.wallet.updateMany({
                where: {
                    id: wallet.id,
                    balanceAvailable: {
                        gte: value,
                    },
                },
                data: {
                    balanceAvailable: {
                        decrement: value,
                    },
                },
            });

            if (result.count !== 1) {
                throw new BadRequestException('Insufficient balance');
            }

            await tx.walletTransaction.create({
                data: {
                    walletId: wallet.id,
                    type: WalletTransactionType.SETTLEMENT,
                    amount: value,
                    status: WalletTransactionStatus.CONFIRMED,
                    meta,
                },
            });

            return true;
        });
    }

    async transfer(params: {
        fromUserId: string;
        toUserId: string;
        amount: Decimal | number;
        reference?: string;
        tx: Prisma.TransactionClient;
    }) {
        const value = this.toDecimal(params.amount);
        const {fromUserId, toUserId, tx, reference} = params;

        const fromWallet = await tx.wallet.findUnique({
            where: {userId: fromUserId},
        });
        const toWallet = await tx.wallet.findUnique({
            where: {userId: toUserId},
        });

        if (!fromWallet || !toWallet) {
            throw new BadRequestException('Wallet not found');
        }

        // debit sender
        const debit = await tx.wallet.updateMany({
            where: {
                id: fromWallet.id,
                balanceAvailable: {gte: value},
            },
            data: {
                balanceAvailable: {decrement: value},
            },
        });

        if (debit.count !== 1) {
            throw new BadRequestException('Insufficient balance for transfer');
        }

        await tx.walletTransaction.create({
            data: {
                walletId: fromWallet.id,
                type: WalletTransactionType.SETTLEMENT,
                amount: value.negated(),
                status: WalletTransactionStatus.CONFIRMED,
                meta: {
                    kind: 'TRANSFER_OUT',
                    reference,
                    toUserId,
                },
            },
        });

        // credit receiver
        await tx.wallet.update({
            where: {id: toWallet.id},
            data: {
                balanceAvailable: {increment: value},
            },
        });

        await tx.walletTransaction.create({
            data: {
                walletId: toWallet.id,
                type: WalletTransactionType.SETTLEMENT,
                amount: value,
                status: WalletTransactionStatus.CONFIRMED,
                meta: {
                    kind: 'TRANSFER_IN',
                    reference,
                    fromUserId,
                },
            },
        });
    }

}
