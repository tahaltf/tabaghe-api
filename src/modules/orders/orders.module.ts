import { Module } from '@nestjs/common';
import { OrdersService } from './orders.service';
import { OrdersController } from './orders.controller';
import { WalletModule } from "../wallet/wallet.module";
import { FeesModule } from "../fees/fees.module";

@Module({
  controllers: [OrdersController],
  providers: [OrdersService],
  imports:[WalletModule , FeesModule]

})
export class OrdersModule {}
