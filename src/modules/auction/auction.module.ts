import {Module} from '@nestjs/common';
import {AuctionService} from './auction.service';
import {AuctionController} from './auction.controller';
import {PrismaModule} from '../../infrastructure/prisma/prisma.module';
import {WalletModule} from '../wallet/wallet.module';
import {AuctionGateway} from "./auction.gateway";
import {AuctionJob} from "./auction.job";
import {AuctionScheduler} from "./auction.scheduler";
import {NotificationModule} from "../notification/notification.module";
import {AdminAuctionController} from "./admin-auction.controller";
import {IdempotencyService} from "../../common/idempotency.service";
import {AdminLedgerController} from "./admin-ledger.controller";
import {AdminAuctionAuditController} from "./admin-auction-audit.controller";
import { FeesModule } from "../fees/fees.module";

@Module({
    imports: [PrismaModule, WalletModule, NotificationModule , FeesModule],
    controllers: [AuctionController,
        AdminAuctionController,
        AdminAuctionAuditController,
        AdminLedgerController,
    ],
    providers: [AuctionService, AuctionGateway, AuctionJob, AuctionScheduler, IdempotencyService],
    exports:[AuctionService]
})
export class AuctionModule {
}
