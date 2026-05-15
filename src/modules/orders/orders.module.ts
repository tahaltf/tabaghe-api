import { Module } from '@nestjs/common';
import { WalletModule } from '../wallet/wallet.module';
import { FeesModule } from '../fees/fees.module';
import { PaymentsModule } from '../payments/payments.module';
import { NotificationModule } from '../notification/notification.module';
import { ExchangeModule } from '../exchange/exchange.module';
import { QuotaModule } from '../quota/quota.module';

import { OrdersAdminController } from './orders-admin.controller';
import { OrdersController } from './orders.controller';
import { OrdersAdminService } from './orders-admin.service';
import { OrdersCommandService } from './orders-command.service';
import { OrdersQueryService } from './orders-query.service';
import { OrdersService } from './orders.service';
import { OrdersStateMachineService } from './orders-state-machine.service';
import { OrderReputationService } from './order-reputation.service';

@Module({
  imports: [
    WalletModule,
    FeesModule,
    PaymentsModule,
    NotificationModule,
    ExchangeModule,
    QuotaModule,
  ],
  controllers: [OrdersController, OrdersAdminController],
  providers: [
    OrdersService,
    OrdersStateMachineService,
    OrdersQueryService,
    OrdersCommandService,
    OrdersAdminService,
    OrderReputationService,
  ],
  exports: [OrderReputationService, OrdersService],
})
export class OrdersModule {}
