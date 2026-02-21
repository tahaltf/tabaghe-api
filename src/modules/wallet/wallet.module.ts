import { Module } from '@nestjs/common';
import { WalletService } from './wallet.service';
import { WalletController } from './wallet.controller';

@Module({
  controllers: [WalletController],
  providers: [WalletService],
  exports: [WalletService], // عالیه، هر ماژولی به کیف پول نیاز داشت باید WalletModule را ایمپورت کند
})
export class WalletModule {}