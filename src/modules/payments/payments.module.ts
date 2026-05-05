import { Module } from '@nestjs/common';
import { WalletModule } from '../wallet/wallet.module';
import { PaymentsController } from './payments.controller';
import { PaymentsService } from './payments.service';
import { ZibalGateway } from './gateways/zibal.gateway';
import { NotificationModule } from '../notification/notification.module';
import { ExchangeModule } from '../exchange/exchange.module';

@Module({
  imports: [WalletModule, NotificationModule, ExchangeModule],
  controllers: [PaymentsController],
  providers: [PaymentsService, ZibalGateway],
  exports: [PaymentsService],
})
export class PaymentsModule {}
