import {
    Controller,
    Get,
    Param,
    UseGuards,
} from '@nestjs/common';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { UserRole } from '@prisma/client';
import Decimal from 'decimal.js';

@Controller('admin/wallets')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(UserRole.ADMIN)
export class AdminWalletController {
    constructor(private readonly prisma: PrismaService) {}

    @Get(':userId/audit')
    async auditWallet(@Param('userId') userId: string) {
        const wallet = await this.prisma.wallet.findUnique({
            where: { userId },
            include: {
                transactions: true,
            },
        });

        if (!wallet) {
            return { exists: false };
        }

        const txSum = wallet.transactions.reduce(
            (acc, tx) => acc.plus(tx.amount),
            new Decimal(0),
        );

        const calculatedBalance = txSum;
        const actualBalance = new Decimal(wallet.balanceAvailable)
            .plus(wallet.balanceBlocked);

        return {
            userId,
            balanceAvailable: wallet.balanceAvailable,
            balanceBlocked: wallet.balanceBlocked,
            calculatedBalance: calculatedBalance.toString(),
            actualBalance: actualBalance.toString(),
            isConsistent: calculatedBalance.equals(actualBalance),
            transactionsCount: wallet.transactions.length,
        };
    }
}
