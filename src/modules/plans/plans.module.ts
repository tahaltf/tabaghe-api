import { Module } from '@nestjs/common';
import { PlansService } from './plans.service';
import { PlansController } from './plans.controller';
import { WalletModule } from '../wallet/wallet.module';

@Module({
  providers: [PlansService],
  controllers: [PlansController],
  imports: [WalletModule],
  exports: [PlansService],
})
export class PlansModule {}
