import {Module} from '@nestjs/common';
import {AuctionService} from './auction.service';
import {AuctionController} from './auction.controller';
import {PrismaModule} from '../../prisma/prisma.module';
import {WalletModule} from '../wallet/wallet.module';
import {AuctionGateway} from "./auction.gateway";
import {AuctionJob} from "./auction.job";
import {AuctionScheduler} from "./auction.scheduler";
import {NotificationModule} from "../notification/notification.module";
import {AdminAuctionController} from "./admin-auction.controller";
import {IdempotencyService} from "../../common/idempotency.service";
import {AdminLedgerController} from "./admin-ledger.controller";
import {AdminAuctionAuditController} from "./admin-auction-audit.controller";
import {AdminWalletController} from "../wallet/admin-wallet.controller";

@Module({
    imports: [PrismaModule, WalletModule, NotificationModule],
    controllers: [AuctionController,
        AdminAuctionController,
        AdminWalletController,
        AdminAuctionAuditController,
        AdminLedgerController,
    ],
    providers: [AuctionService, AuctionGateway, AuctionJob, AuctionScheduler, IdempotencyService],
})
export class AuctionModule {
}
