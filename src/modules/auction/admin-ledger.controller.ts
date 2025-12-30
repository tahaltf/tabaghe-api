import {
    Controller,
    Get,
    UseGuards,
} from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { UserRole } from '@prisma/client';
import Decimal from 'decimal.js';

@Controller('admin/ledger')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(UserRole.ADMIN)
export class AdminLedgerController {
    constructor(private readonly prisma: PrismaService) {}

    @Get('inconsistencies')
    async findInconsistencies() {
        const wallets = await this.prisma.wallet.findMany({
            include: { transactions: true },
        });

        const inconsistencies = [];

        for (const wallet of wallets) {
            const txSum = wallet.transactions.reduce(
                (acc, tx) => acc.plus(tx.amount),
                new Decimal(0),
            );

            const actual = new Decimal(wallet.balanceAvailable)
                .plus(wallet.balanceBlocked);

            if (!txSum.equals(actual)) {
                inconsistencies.push({
                    userId: wallet.userId,
                    calculated: txSum.toString(),
                    actual: actual.toString(),
                });
            }
        }

        return {
            count: inconsistencies.length,
            inconsistencies,
        };
    }
}
