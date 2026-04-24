import { Module } from '@nestjs/common';
import { WalletService } from './wallet.service';
import { WalletController } from './wallet.controller';
import { AdminWalletController } from './admin-wallet.controller';
import { PrismaModule } from '../../infrastructure/prisma/prisma.module';
import { NotificationModule } from '../notification/notification.module';

@Module({
  imports: [PrismaModule, NotificationModule],
  controllers: [WalletController, AdminWalletController],
  providers: [WalletService],
  exports: [WalletService],
})
export class WalletModule {}