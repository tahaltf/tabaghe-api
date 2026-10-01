import { Module, forwardRef } from '@nestjs/common';
import { WalletModule } from '../wallet/wallet.module';
import { FeesModule } from '../fees/fees.module';
import { PaymentsModule } from '../payments/payments.module';
import { NotificationModule } from '../notification/notification.module';
import { ExchangeModule } from '../exchange/exchange.module';
import { QuotaModule } from '../quota/quota.module';
import { ListingModule } from '../listing/listing.module';
import { OrderReputationModule } from './order-reputation.module';
import { CouponsModule } from '../coupons/coupons.module';
import { CartModule } from '../cart/cart.module';
import { ReferralModule } from '../referral/referral.module';
import { CurrencyModule } from '../currency/currency.module';

import { OrdersController } from './orders.controller';
import { OrdersAdminService } from './orders-admin.service';
import { OrdersCommandService } from './orders-command.service';
import { OrdersQueryService } from './orders-query.service';
import { OrdersService } from './orders.service';
import { OrdersStateMachineService } from './orders-state-machine.service';
import { InspectionCertificateService } from './inspection-certificate.service';
import { OrdersSettingsService } from './orders-settings.service';
import { OrdersListQueryService } from './services/query/orders-list-query.service';
import { OrdersDetailQueryService } from './services/query/orders-detail-query.service';
import { OrdersResponseEnrichmentService } from './services/query/orders-response-enrichment.service';
import { OrdersCheckoutService } from './services/command/orders-checkout.service';
import { OrdersShippingService } from './services/command/orders-shipping.service';
import { OrdersCompletionService } from './services/command/orders-completion.service';
import { OrdersUnpaidCancelService } from './services/command/orders-unpaid-cancel.service';
import { OrdersSchedulerService } from './services/scheduler/orders-scheduler.service';

@Module({
  imports: [
    WalletModule,
    FeesModule,
    PaymentsModule,
    NotificationModule,
    ExchangeModule,
    QuotaModule,
    ListingModule,
    OrderReputationModule,
    CouponsModule,
    forwardRef(() => CartModule),
    ReferralModule,
    CurrencyModule,
  ],
  controllers: [OrdersController],
  providers: [
    OrdersSettingsService,
    OrdersStateMachineService,
    OrdersResponseEnrichmentService,
    OrdersListQueryService,
    OrdersDetailQueryService,
    OrdersQueryService,
    OrdersCheckoutService,
    OrdersShippingService,
    OrdersCompletionService,
    OrdersUnpaidCancelService,
    OrdersSchedulerService,
    OrdersCommandService,
    OrdersService,
    OrdersAdminService,
    InspectionCertificateService,
  ],
  exports: [
    OrderReputationModule,
    OrdersService,
    OrdersSchedulerService,
    OrdersCompletionService,
    OrdersUnpaidCancelService,
    OrdersStateMachineService,
    OrdersResponseEnrichmentService,
    OrdersCheckoutService,
  ],
})
export class OrdersModule {}
