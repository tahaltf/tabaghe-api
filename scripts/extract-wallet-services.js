/** Extract WalletService into focused services (UTF-8 safe). */
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const srcPath = path.join(root, 'src/modules/wallet/wallet.service.ts');
const lines = fs.readFileSync(srcPath, 'utf8').replace(/\r\n/g, '\n').split('\n');

function slice(start, end) {
  return lines.slice(start - 1, end).join('\n');
}

const constantsFile = `import { WalletTransactionStatus, WalletTransactionType } from '@prisma/client';

/**
 * Marker stored inside \`WalletTransaction.meta.kind\` to distinguish user-initiated
 * top-up requests (DEPOSIT + PENDING, awaiting admin approval) from escrow
 * deposits credited to sellers when a buyer pays.
 */
export const MANUAL_DEPOSIT_KIND = 'manual-deposit';
export const GATEWAY_TOPUP_KIND = 'gateway-topup';

export const ALLOWED_WALLET_META_KEYS = new Set([
  'kind',
  'phase',
  'description',
  'orderId',
  'listingId',
  'listingTitle',
  'auctionId',
  'refundReason',
  'debitReason',
  'receiptImageUrl',
  'rejectionReason',
  'adminNote',
  'repairTrackingCode',
  'paymentSource',
  'settlementKind',
  'agreementAmount',
]);

export type UserWalletTxFilter =
  | 'ALL'
  | 'INCOME'
  | 'EXPENSE'
  | 'BLOCKED'
  | 'PENDING';

export type WalletTxnRow = {
  id: string;
  type: WalletTransactionType;
  status: WalletTransactionStatus;
  amount: unknown;
  referenceId: string | null;
  createdAt: Date;
  meta: unknown;
};
`;

const baseImports = `import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../../../infrastructure/prisma/prisma.service';
import {
  WalletTransactionType,
  WalletTransactionStatus,
  Prisma,
  NotificationType,
} from '@prisma/client';
import Decimal from 'decimal.js';
import { NotificationService } from '../../notification/notification.service';
`;

const queryImports = `${baseImports}
import {
  buildPaginationMeta,
  DEFAULT_PAGE,
  DEFAULT_PAGE_SIZE,
} from '../../../shared/contracts/pagination';
import { ALLOWED_WALLET_META_KEYS, UserWalletTxFilter, WalletTxnRow } from '../../wallet.constants';
import { WalletSupportService } from '../support/wallet-support.service';
`;

const supportBody = slice(72, 141) + '\n\n' + slice(424, 432);

const queryBody = slice(143, 422) + '\n\n' + slice(434, 508);
const queryBodyFixed = queryBody
  .replace(/this\.ensureUserWallet\(/g, 'this.support.ensureUserWallet(');

const blockBody = slice(509, 681);
const blockBodyFixed = blockBody.replace(
  /this\.getWalletByUserId\(/g,
  'this.query.getWalletByUserId(',
);

const escrowBody =
  slice(682, 963) +
  '\n\n' +
  slice(965, 1286) +
  '\n\n' +
  slice(1291, 1393) +
  '\n\n' +
  slice(3055, 3084);
const escrowBodyFixed = escrowBody
  .replace(/this\.listingTitleForWalletTx\(/g, 'this.support.listingTitleForWalletTx(')
  .replace(/this\.getWalletByUserId\(/g, 'this.query.getWalletByUserId(')
  .replace(/this\.getAuctionBidDepositScopedBlocked\(/g, 'this.block.getAuctionBidDepositScopedBlocked(');

const refundBody = slice(1396, 2513);
const refundBodyFixed = refundBody
  .replace(/this\.listingTitleForWalletTx\(/g, 'this.support.listingTitleForWalletTx(')
  .replace(/this\.notifyWalletRefund\(/g, 'this.support.notifyWalletRefund(')
  .replace(/this\.settlementBelongsToExchangeOrder\(/g, 'this.support.settlementBelongsToExchangeOrder(')
  .replace(/this\.debitOrderScopedBlocked\(/g, 'this.escrow.debitOrderScopedBlocked(')
  .replace(/this\.escrowDepositBelongsToOrder\(/g, 'this.escrow.escrowDepositBelongsToOrder(');

const depositBody = slice(2519, 3054);
const depositBodyFixed = depositBody
  .replace(/this\.getWalletByUserId\(/g, 'this.query.getWalletByUserId(')
  .replace(/MANUAL_DEPOSIT_KIND/g, 'MANUAL_DEPOSIT_KIND');

const supportFile = `${baseImports}

@Injectable()
export class WalletSupportService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly notificationService: NotificationService,
  ) {}

${supportBody}
}
`;

const queryFile = `${queryImports}

@Injectable()
export class WalletQueryService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly support: WalletSupportService,
  ) {}

${queryBodyFixed}
}
`;

const blockFile = `${baseImports}
import { WalletQueryService } from '../query/wallet-query.service';

@Injectable()
export class WalletBlockService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly query: WalletQueryService,
  ) {}

${blockBodyFixed}
}
`;

const escrowFile = `${baseImports}
import { WalletSupportService } from '../support/wallet-support.service';
import { WalletQueryService } from '../query/wallet-query.service';
import { WalletBlockService } from '../block/wallet-block.service';

@Injectable()
export class WalletEscrowService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly support: WalletSupportService,
    private readonly query: WalletQueryService,
    private readonly block: WalletBlockService,
  ) {}

${escrowBodyFixed}
}
`;

const refundFile = `${baseImports}
import { WalletSupportService } from '../support/wallet-support.service';
import { WalletEscrowService } from '../escrow/wallet-escrow.service';

@Injectable()
export class WalletRefundService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly support: WalletSupportService,
    private readonly escrow: WalletEscrowService,
  ) {}

${refundBodyFixed}
}
`;

const depositFile = `${baseImports}
import { MANUAL_DEPOSIT_KIND } from '../../wallet.constants';
import { WalletQueryService } from '../query/wallet-query.service';

@Injectable()
export class WalletDepositWithdrawService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly notificationService: NotificationService,
    private readonly query: WalletQueryService,
  ) {}

${depositBodyFixed}
}
`;

const publicMethods = [
  'getWalletByUserId',
  'getUserWalletTransactions',
  'blockAmount',
  'getAuctionBidDepositScopedBlocked',
  'unblockAmount',
  'confiscateBlocked',
  'payAuctionFinal',
  'settleAuctionGatewayPayment',
  'transferToEscrow',
  'creditExternalPaymentToEscrow',
  'resolveOrderScopedCap',
  'debitOrderScopedBlocked',
  'releaseEscrow',
  'linkEscrowDepositsToOrder',
  'getOrderScopedBlockedAmount',
  'refundDirectOrderEscrowOnCancel',
  'repairMissingDirectCancelRefund',
  'refundExchangeExtraOnCancel',
  'resolveExchangeParticipantPaidAmount',
  'refundExchangePaymentTimeoutOnCancel',
  'refundExchangeOneSideNoShipmentOnCancel',
  'refundExchangeBothNoShipmentOnCancel',
  'applyExchangeHubInspectionOutcomeRefunds',
  'deposit',
  'requestDeposit',
  'getDepositRequestsAdmin',
  'processDeposit',
  'requestWithdraw',
  'getWithdrawRequestsAdmin',
  'processWithdraw',
  'payFromAvailable',
];

const facadeMethods = {
  getWalletByUserId: 'query',
  getUserWalletTransactions: 'query',
  blockAmount: 'block',
  getAuctionBidDepositScopedBlocked: 'block',
  unblockAmount: 'block',
  confiscateBlocked: 'block',
  payAuctionFinal: 'escrow',
  settleAuctionGatewayPayment: 'escrow',
  transferToEscrow: 'escrow',
  creditExternalPaymentToEscrow: 'escrow',
  resolveOrderScopedCap: 'escrow',
  debitOrderScopedBlocked: 'escrow',
  releaseEscrow: 'escrow',
  linkEscrowDepositsToOrder: 'escrow',
  getOrderScopedBlockedAmount: 'escrow',
  refundDirectOrderEscrowOnCancel: 'refund',
  repairMissingDirectCancelRefund: 'refund',
  refundExchangeExtraOnCancel: 'refund',
  resolveExchangeParticipantPaidAmount: 'refund',
  refundExchangePaymentTimeoutOnCancel: 'refund',
  refundExchangeOneSideNoShipmentOnCancel: 'refund',
  refundExchangeBothNoShipmentOnCancel: 'refund',
  applyExchangeHubInspectionOutcomeRefunds: 'refund',
  deposit: 'depositWithdraw',
  requestDeposit: 'depositWithdraw',
  getDepositRequestsAdmin: 'depositWithdraw',
  processDeposit: 'depositWithdraw',
  requestWithdraw: 'depositWithdraw',
  getWithdrawRequestsAdmin: 'depositWithdraw',
  processWithdraw: 'depositWithdraw',
  payFromAvailable: 'escrow',
};

const facadeBody = publicMethods
  .map((name) => {
    const svc = facadeMethods[name];
    return `  ${name}(...args: Parameters<Wallet${svc === 'query' ? 'Query' : svc === 'block' ? 'Block' : svc === 'escrow' ? 'Escrow' : svc === 'refund' ? 'Refund' : 'DepositWithdraw'}Service['${name}']>) {
    return this.${svc}.${name}(...args);
  }`;
  })
  .join('\n\n');

const facadeFile = `import { Injectable } from '@nestjs/common';
import { WalletQueryService } from './services/query/wallet-query.service';
import { WalletBlockService } from './services/block/wallet-block.service';
import { WalletEscrowService } from './services/escrow/wallet-escrow.service';
import { WalletRefundService } from './services/refund/wallet-refund.service';
import { WalletDepositWithdrawService } from './services/deposit-withdraw/wallet-deposit-withdraw.service';

export type { UserWalletTxFilter } from './wallet.constants';

/**
 * Backward-compatible facade. Prefer injecting specialized services directly.
 */
@Injectable()
export class WalletService {
  constructor(
    private readonly query: WalletQueryService,
    private readonly block: WalletBlockService,
    private readonly escrow: WalletEscrowService,
    private readonly refund: WalletRefundService,
    private readonly depositWithdraw: WalletDepositWithdrawService,
  ) {}

${facadeBody}
}
`;

const moduleFile = `import { Module } from '@nestjs/common';
import { WalletService } from './wallet.service';
import { WalletController } from './wallet.controller';
import { AdminWalletController } from './admin-wallet.controller';
import { PrismaModule } from '../../infrastructure/prisma/prisma.module';
import { NotificationModule } from '../notification/notification.module';
import { WalletSupportService } from './services/support/wallet-support.service';
import { WalletQueryService } from './services/query/wallet-query.service';
import { WalletBlockService } from './services/block/wallet-block.service';
import { WalletEscrowService } from './services/escrow/wallet-escrow.service';
import { WalletRefundService } from './services/refund/wallet-refund.service';
import { WalletDepositWithdrawService } from './services/deposit-withdraw/wallet-deposit-withdraw.service';

@Module({
  imports: [PrismaModule, NotificationModule],
  controllers: [WalletController, AdminWalletController],
  providers: [
    WalletSupportService,
    WalletQueryService,
    WalletBlockService,
    WalletEscrowService,
    WalletRefundService,
    WalletDepositWithdrawService,
    WalletService,
  ],
  exports: [
    WalletService,
    WalletQueryService,
    WalletBlockService,
    WalletEscrowService,
    WalletRefundService,
    WalletDepositWithdrawService,
  ],
})
export class WalletModule {}
`;

const out = (rel, content) => {
  const p = path.join(root, rel);
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, content, 'utf8');
  console.log('wrote', rel, content.split('\n').length, 'lines');
};

out('src/modules/wallet/wallet.constants.ts', constantsFile);
out('src/modules/wallet/services/support/wallet-support.service.ts', supportFile);
out('src/modules/wallet/services/query/wallet-query.service.ts', queryFile);
out('src/modules/wallet/services/block/wallet-block.service.ts', blockFile);
out('src/modules/wallet/services/escrow/wallet-escrow.service.ts', escrowFile);
out('src/modules/wallet/services/refund/wallet-refund.service.ts', refundFile);
out('src/modules/wallet/services/deposit-withdraw/wallet-deposit-withdraw.service.ts', depositFile);
out('src/modules/wallet/wallet.service.ts', facadeFile);
out('src/modules/wallet/wallet.module.ts', moduleFile);

console.log('done');
