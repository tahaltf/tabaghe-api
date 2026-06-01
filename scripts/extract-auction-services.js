/** Extract AuctionService into focused services (UTF-8 safe). */
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const srcPath = path.join(root, 'src/modules/auction/auction.service.ts');
const lines = fs.readFileSync(srcPath, 'utf8').replace(/\r\n/g, '\n').split('\n');

function slice(start, end) {
  return lines.slice(start - 1, end).join('\n');
}

const constantsFile = `export const TOP_BIDDERS_LIMIT = 4;
export const DEFAULT_LAST_MINUTE_EXTENSION_MINUTES = 10;
export const DEFAULT_WINNER_PAYMENT_DEADLINE_HOURS = 48;
export const DEFAULT_SECOND_CHANCE_PAYMENT_DEADLINE_HOURS = 24;
export const MIN_TRUST_SCORE_FOR_AUCTION = 40;
export const DEFAULT_AUCTION_DEPOSIT_MIN = 50_000;
export const DEFAULT_AUCTION_DEPOSIT_MAX = 500_000_000;
export const DEFAULT_MAX_BIDS_PER_MINUTE = 20;
export const DEFAULT_MAX_ACTIVE_AUCTIONS_PER_USER = 15;
export const DEFAULT_MAX_REBIDS_PER_10_MIN = 8;
export const DEFAULT_MAX_BID_JUMP_MULTIPLIER = 2.5;
`;

const sharedImports = `import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  AuctionBidStatus,
  AuctionStatus,
  AuctionSettlementStatus,
  ListingType,
  SecondChanceOfferStatus,
} from '@prisma/client';
import Decimal from 'decimal.js';
import { PrismaService } from '../../../infrastructure/prisma/prisma.service';
`;

const supportBody = slice(46, 259);
const biddingBody = slice(264, 526) + '\n\n' + slice(974, 1069);
const settlementBody =
  slice(531, 972) + '\n\n' + slice(1240, 1281);
const queryBody = slice(1074, 1234);

const supportReplacements = (body) => body;

const crossSupport = (body) =>
  body
    .replace(/this\.getWinnerPaymentDeadlineHours\(/g, 'this.support.getWinnerPaymentDeadlineHours(')
    .replace(/this\.getSecondChancePaymentDeadlineHours\(/g, 'this.support.getSecondChancePaymentDeadlineHours(')
    .replace(/this\.getLastMinuteExtensionMinutes\(/g, 'this.support.getLastMinuteExtensionMinutes(')
    .replace(/this\.getNumericSetting\(/g, 'this.support.getNumericSetting(')
    .replace(/this\.getPolicyNumber\(/g, 'this.support.getPolicyNumber(')
    .replace(/this\.getAuctionDepositPercent\(/g, 'this.support.getAuctionDepositPercent(')
    .replace(/this\.getFixedDepositAmount\(/g, 'this.support.getFixedDepositAmount(')
    .replace(/this\.getTopActiveBids\(/g, 'this.support.getTopActiveBids(')
    .replace(/this\.syncAuctionRanking\(/g, 'this.support.syncAuctionRanking(')
    .replace(/this\.appendAuctionLedgerEvent\(/g, 'this.support.appendAuctionLedgerEvent(')
    .replace(/this\.appendAuctionTimelineEvent\(/g, 'this.support.appendAuctionTimelineEvent(')
    .replace(/TOP_BIDDERS_LIMIT/g, 'TOP_BIDDERS_LIMIT')
    .replace(/DEFAULT_LAST_MINUTE_EXTENSION_MINUTES/g, 'DEFAULT_LAST_MINUTE_EXTENSION_MINUTES')
    .replace(/DEFAULT_WINNER_PAYMENT_DEADLINE_HOURS/g, 'DEFAULT_WINNER_PAYMENT_DEADLINE_HOURS')
    .replace(/DEFAULT_SECOND_CHANCE_PAYMENT_DEADLINE_HOURS/g, 'DEFAULT_SECOND_CHANCE_PAYMENT_DEADLINE_HOURS')
    .replace(/MIN_TRUST_SCORE_FOR_AUCTION/g, 'MIN_TRUST_SCORE_FOR_AUCTION')
    .replace(/DEFAULT_AUCTION_DEPOSIT_MIN/g, 'DEFAULT_AUCTION_DEPOSIT_MIN')
    .replace(/DEFAULT_AUCTION_DEPOSIT_MAX/g, 'DEFAULT_AUCTION_DEPOSIT_MAX')
    .replace(/DEFAULT_MAX_BIDS_PER_MINUTE/g, 'DEFAULT_MAX_BIDS_PER_MINUTE')
    .replace(/DEFAULT_MAX_ACTIVE_AUCTIONS_PER_USER/g, 'DEFAULT_MAX_ACTIVE_AUCTIONS_PER_USER')
    .replace(/DEFAULT_MAX_REBIDS_PER_10_MIN/g, 'DEFAULT_MAX_REBIDS_PER_10_MIN')
    .replace(/DEFAULT_MAX_BID_JUMP_MULTIPLIER/g, 'DEFAULT_MAX_BID_JUMP_MULTIPLIER');

const supportFile = `${sharedImports}
import { appendJsonLog } from '../../../common/logging/app-log.util';
import { readPositiveIntSetting } from '../../../common/system-settings/numeric-setting.util';
import {
  TOP_BIDDERS_LIMIT,
  DEFAULT_LAST_MINUTE_EXTENSION_MINUTES,
  DEFAULT_WINNER_PAYMENT_DEADLINE_HOURS,
  DEFAULT_SECOND_CHANCE_PAYMENT_DEADLINE_HOURS,
  DEFAULT_AUCTION_DEPOSIT_MIN,
  DEFAULT_AUCTION_DEPOSIT_MAX,
  DEFAULT_MAX_BIDS_PER_MINUTE,
  DEFAULT_MAX_ACTIVE_AUCTIONS_PER_USER,
  DEFAULT_MAX_REBIDS_PER_10_MIN,
  DEFAULT_MAX_BID_JUMP_MULTIPLIER,
  MIN_TRUST_SCORE_FOR_AUCTION,
} from '../auction.constants';

@Injectable()
export class AuctionSupportService {
  constructor(private readonly prisma: PrismaService) {}

${supportReplacements(supportBody).replace(/^  private /gm, '  ')}
}
`;

const biddingImports = `${sharedImports}
import { WalletService } from '../../wallet/wallet.service';
import { FeeCalculatorService } from '../../fees/fee-calculator.service';
import { AuctionGateway } from '../auction.gateway';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { AuctionEvents } from '../auction.events';
import { AuctionSupportService } from './auction-support.service';
import { MIN_TRUST_SCORE_FOR_AUCTION } from '../auction.constants';
`;

const settlementImports = `${sharedImports}
import { WalletService } from '../../wallet/wallet.service';
import { FeeCalculatorService } from '../../fees/fee-calculator.service';
import { AuctionGateway } from '../auction.gateway';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { AuctionEvents } from '../auction.events';
import { AuctionSupportService } from './auction-support.service';
import { DEFAULT_WINNER_PAYMENT_DEADLINE_HOURS } from '../auction.constants';
`;

const queryImports = `${sharedImports}
import { AuctionSupportService } from './auction-support.service';
`;

const biddingFile = `${biddingImports}

@Injectable()
export class AuctionBiddingService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly walletService: WalletService,
    private readonly feeCalculator: FeeCalculatorService,
    private readonly auctionGateway: AuctionGateway,
    private readonly eventEmitter: EventEmitter2,
    private readonly support: AuctionSupportService,
  ) {}

${crossSupport(biddingBody)}
}
`;

const settlementFile = `${settlementImports}

@Injectable()
export class AuctionSettlementService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly walletService: WalletService,
    private readonly feeCalculator: FeeCalculatorService,
    private readonly auctionGateway: AuctionGateway,
    private readonly eventEmitter: EventEmitter2,
    private readonly support: AuctionSupportService,
  ) {}

${crossSupport(settlementBody)}
}
`;

const queryFile = `${queryImports}

@Injectable()
export class AuctionQueryService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly support: AuctionSupportService,
  ) {}

${crossSupport(queryBody)}
}
`;

const publicMethods = [
  ['placeBid', 'bidding'],
  ['finalizeAuction', 'settlement'],
  ['payAuction', 'settlement'],
  ['checkUnpaidAuctions', 'settlement'],
  ['penalizeWinner', 'settlement'],
  ['declineSecondChance', 'settlement'],
  ['cancelBid', 'bidding'],
  ['buyNow', 'bidding'],
  ['getAuctionState', 'query'],
  ['getAuctionBids', 'query'],
  ['getAuctionCheckoutData', 'query'],
  ['forcePenalizeWinner', 'settlement'],
  ['forceRefundAuction', 'settlement'],
  ['forceSettleAuction', 'settlement'],
];

const svcType = {
  bidding: 'AuctionBiddingService',
  settlement: 'AuctionSettlementService',
  query: 'AuctionQueryService',
};

const facadeMethods = publicMethods
  .map(([name, svc]) => {
    return `  ${name}(...args: Parameters<${svcType[svc]}['${name}']>) {
    return this.${svc}.${name}(...args);
  }`;
  })
  .join('\n\n');

const facadeFile = `import { Injectable } from '@nestjs/common';
import { AuctionBiddingService } from './services/auction-bidding.service';
import { AuctionSettlementService } from './services/auction-settlement.service';
import { AuctionQueryService } from './services/auction-query.service';

/**
 * Backward-compatible facade. Prefer injecting specialized services directly.
 */
@Injectable()
export class AuctionService {
  constructor(
    private readonly bidding: AuctionBiddingService,
    private readonly settlement: AuctionSettlementService,
    private readonly query: AuctionQueryService,
  ) {}

${facadeMethods}
}
`;

const moduleFile = `import { Module } from '@nestjs/common';
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
import { FeesModule } from '../fees/fees.module';
import { AuctionSupportService } from './services/auction-support.service';
import { AuctionBiddingService } from './services/auction-bidding.service';
import { AuctionSettlementService } from './services/auction-settlement.service';
import { AuctionQueryService } from './services/auction-query.service';

@Module({
  imports: [PrismaModule, WalletModule, NotificationModule, FeesModule],
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
`;

const out = (rel, content) => {
  const p = path.join(root, rel);
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, content, 'utf8');
  console.log('wrote', rel, content.split('\n').length, 'lines');
};

out('src/modules/auction/auction.constants.ts', constantsFile);
out('src/modules/auction/services/auction-support.service.ts', supportFile);
out('src/modules/auction/services/auction-bidding.service.ts', biddingFile);
out('src/modules/auction/services/auction-settlement.service.ts', settlementFile);
out('src/modules/auction/services/auction-query.service.ts', queryFile);
out('src/modules/auction/auction.service.ts', facadeFile);
out('src/modules/auction/auction.module.ts', moduleFile);

console.log('done');
