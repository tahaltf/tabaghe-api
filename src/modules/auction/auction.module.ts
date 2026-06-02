import { Module } from '@nestjs/common';
import { AuctionService } from './auction.service';
import { AuctionController } from './auction.controller';
import { PrismaModule } from '../../infrastructure/prisma/prisma.module';
import { WalletModule } from '../wallet/wallet.module';
import { AuctionGateway } from './auction.gateway';
import { AuctionJob } from './auction.job';
import { AuctionScheduler } from './auction.scheduler';
import { NotificationModule } from '../notification/notification.module';
import { AdminAuctionController } from './admin-auction.controller';
import { IdempotencyService } from '../../common/idempotency.service';
import { AdminLedgerController } from './admin-ledger.controller';
import { AdminAuctionAuditController } from './admin-auction-audit.controller';
import { OrdersModule } from '../../orders/orders.module';
import { OrderReputationService } from '../../orders/order-reputation.service';
import { AuctionSupportService } from './services/auction-support.service';
import { AuctionBiddingService } from './services/auction-bidding.service';
import { AuctionSettlementService } from './services/auction-settlement.service';
import { AuctionQueryService } from './services/auction-query.service';

@Module({
  imports: [PrismaModule, WalletModule, NotificationModule, FeesModule, OrdersModule],
  controllers: [
    AuctionController,
    AdminAuctionController,
    AdminAuctionAuditController,
    AdminLedgerController,
  ],
  providers: [
    AuctionSupportService,
    AuctionBiddingService,
    AuctionSettlementService,
    AuctionQueryService,
    AuctionService,
    AuctionGateway,
    AuctionJob,
    AuctionScheduler,
    IdempotencyService,
  ],
  exports: [
    AuctionService,
    AuctionBiddingService,
    AuctionSettlementService,
    AuctionQueryService,
  ],
})
export class AuctionModule {}
