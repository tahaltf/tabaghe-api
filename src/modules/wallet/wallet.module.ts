import { Module } from '@nestjs/common';
import { WalletService } from './wallet.service';
import { WalletController } from './wallet.controller';
import { AdminWalletController } from './admin-wallet.controller';
import { PrismaModule } from '../../infrastructure/prisma/prisma.module';
import { NotificationModule } from '../notification/notification.module';
import { AuthModule } from '../auth/auth.module';
import { WalletSupportService } from './services/support/wallet-support.service';
import { WalletQueryService } from './services/query/wallet-query.service';
import { WalletBlockService } from './services/block/wallet-block.service';
import { WalletEscrowService } from './services/escrow/wallet-escrow.service';
import { WalletRefundService } from './services/refund/wallet-refund.service';
import { WalletDepositWithdrawService } from './services/deposit-withdraw/wallet-deposit-withdraw.service';

@Module({
  imports: [PrismaModule, NotificationModule, AuthModule],
  controllers: [WalletController, AdminWalletController],
  providers: [
    WalletSupportService,
    WalletQueryService,
    WalletBlockService,
    WalletEscrowService,
    WalletRefundService,
    WalletDepositWithdrawService,
    WalletService,
  ],
  exports: [
    WalletService,
    WalletQueryService,
    WalletBlockService,
    WalletEscrowService,
    WalletRefundService,
    WalletDepositWithdrawService,
  ],
})
export class WalletModule {}
