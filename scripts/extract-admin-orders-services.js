/** Extract AdminOrdersCommandService into focused services (UTF-8 safe). */
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const srcPath = path.join(
  root,
  'src/modules/admin/services/admin-orders-command.service.ts',
);
const lines = fs.readFileSync(srcPath, 'utf8').replace(/\r\n/g, '\n').split('\n');

function slice(start, end) {
  return lines.slice(start - 1, end).join('\n');
}

const constantsFile = `import { OrderStatus } from '@prisma/client';

export const EXCHANGE_INSPECTION_TICKET_TEMPLATE_KEYS = {
  BOTH_FAILED: 'EXCHANGE_INSPECTION_TICKET_TEMPLATE_BOTH_FAILED',
  OWN_FAILED: 'EXCHANGE_INSPECTION_TICKET_TEMPLATE_OWN_FAILED',
  OTHER_FAILED: 'EXCHANGE_INSPECTION_TICKET_TEMPLATE_OTHER_FAILED',
} as const;

export const STATUS_LABELS: Partial<Record<OrderStatus, string>> = {
  PENDING: 'در انتظار',
  AWAITING_PAYMENT: 'در انتظار پرداخت',
  PAID: 'پرداخت شد',
  AWAITING_SHIPMENT_TO_HUB: 'در انتظار ارسال به هاب',
  SHIPPED_TO_HUB: 'ارسال شده به هاب',
  RECEIVED_AT_HUB: 'تحویل هاب شد',
  CHECKING_AT_HUB: 'در حال بررسی در هاب',
  VERIFIED_AT_HUB: 'تایید در هاب',
  REJECTED_AT_HUB: 'رد شده در هاب',
  SHIPPED_TO_BUYER: 'ارسال به خریدار',
  SHIPPED: 'ارسال شد',
  DELIVERED: 'تحویل داده شد',
  RETURN_REQUESTED: 'در انتظار ثبت مرجوعی خریدار',
  RETURN_SHIPPED: 'مرجوعی توسط خریدار ارسال شد',
  COMPLETED: 'تکمیل شد',
  DISPUTED: 'اختلاف',
  CANCELLED: 'لغو شد',
};
`;

const sharedImports = `import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  ExchangeOfferStatus,
  ListingStatus,
  ListingType,
  NotificationType,
  OrderStatus,
  Prisma,
  UserRole,
  WalletTransactionStatus,
  WalletTransactionType,
} from '@prisma/client';
import { PrismaService } from '../../../../infrastructure/prisma/prisma.service';
`;

const notifyBody = slice(3040, 3184);
const statusBody = slice(63, 489);
const hubBody = slice(491, 1061);
const inspectionBody =
  slice(1066, 2114) + '\n\n' + slice(3186, 3486);
const escrowBody = slice(2116, 3038);

const statusBodyFixed = statusBody
  .replace(/this\.buildDirectHubInspectionRejectionMessaging\(/g, 'this.notify.buildDirectHubInspectionRejectionMessaging(')
  .replace(/this\.notifyHubInspectionRejectedPartiesPush\(/g, 'this.notify.notifyHubInspectionRejectedPartiesPush(')
  .replace(/this\.notifyParties\(/g, 'this.notify.notifyParties(');

const hubBodyFixed = hubBody
  .replace(/this\.ordersService\./g, 'this.ordersService.');

const inspectionBodyFixed = inspectionBody
  .replace(/this\.notifyParties\(/g, 'this.notify.notifyParties(')
  .replace(/EXCHANGE_INSPECTION_TICKET_TEMPLATE_KEYS/g, 'EXCHANGE_INSPECTION_TICKET_TEMPLATE_KEYS');

const escrowBodyFixed = escrowBody.replace(
  /this\.notifyParties\(/g,
  'this.notify.notifyParties(',
);

const notifyFile = `${sharedImports}
import {
  OrderReputationService,
  TRADE_REPUTATION_PENALTY_DELTA,
} from '../../../orders/order-reputation.service';
import {
  buildOrderTicketSubject,
  formatTicketMessageBody,
} from '../../../../common/ticket-message.util';
import { STATUS_LABELS } from '../admin-orders.constants';

@Injectable()
export class AdminOrdersNotifyService {
  constructor(private readonly prisma: PrismaService) {}

${notifyBody.replace(/^  private /gm, '  ')}
}
`;

const statusFile = `${sharedImports}
import { AppSettingsService } from '../../../../shared/settings/app-settings.service';
import { OrderReputationService } from '../../../orders/order-reputation.service';
import { WalletService } from '../../../wallet/wallet.service';
import { OrdersService } from '../../../orders/orders.service';
import { OrdersStateMachineService } from '../../../orders/orders-state-machine.service';
import { enrichOrderUpdateForCompletion } from '../../../orders/order-lifecycle.util';
import { ListingCommandService } from '../../../listing/services/listing-command.service';
import {
  buildOrderTicketSubject,
  formatTicketMessageBody,
} from '../../../../common/ticket-message.util';
import { AdminOrdersNotifyService } from './admin-orders-notify.service';

@Injectable()
export class AdminOrdersStatusService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly appSettings: AppSettingsService,
    private readonly orderReputation: OrderReputationService,
    private readonly walletService: WalletService,
    private readonly ordersService: OrdersService,
    private readonly listingCommand: ListingCommandService,
    private readonly stateMachine: OrdersStateMachineService,
    private readonly notify: AdminOrdersNotifyService,
  ) {}

${statusBodyFixed}
}
`;

const hubFile = `${sharedImports}
import {
  SetExchangeHubReceiptDto,
  SetHubShippingCodesDto,
  SetParticipantShippingDto,
} from '../../dto/admin-order.dto';
import { OrderReputationService } from '../../../orders/order-reputation.service';
import { WalletService } from '../../../wallet/wallet.service';
import { OrdersService } from '../../../orders/orders.service';
import { ListingCommandService } from '../../../listing/services/listing-command.service';
import { buildOrderTicketSubject } from '../../../../common/ticket-message.util';

@Injectable()
export class AdminOrdersHubService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly orderReputation: OrderReputationService,
    private readonly walletService: WalletService,
    private readonly ordersService: OrdersService,
    private readonly listingCommand: ListingCommandService,
  ) {}

${hubBodyFixed}
}
`;

const inspectionFile = `${sharedImports}
import { FinalizeExchangeHubInspectionDto, RejectExchangeFakeShipmentDto } from '../../dto/admin-order.dto';
import { AppSettingsService } from '../../../../shared/settings/app-settings.service';
import { readPositiveIntSetting } from '../../../../common/system-settings/numeric-setting.util';
import { FeeCalculatorService } from '../../../fees/fee-calculator.service';
import {
  OrderReputationService,
  TRADE_REPUTATION_PENALTY_DELTA,
} from '../../../orders/order-reputation.service';
import { WalletService } from '../../../wallet/wallet.service';
import { ListingCommandService } from '../../../listing/services/listing-command.service';
import {
  buildOrderTicketSubject,
  formatTicketMessageBody,
} from '../../../../common/ticket-message.util';
import { EXCHANGE_INSPECTION_TICKET_TEMPLATE_KEYS } from '../admin-orders.constants';
import { AdminOrdersNotifyService } from './admin-orders-notify.service';

@Injectable()
export class AdminOrdersInspectionService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly appSettings: AppSettingsService,
    private readonly feeCalculator: FeeCalculatorService,
    private readonly orderReputation: OrderReputationService,
    private readonly walletService: WalletService,
    private readonly listingCommand: ListingCommandService,
    private readonly notify: AdminOrdersNotifyService,
  ) {}

${inspectionBodyFixed}
}
`;

const escrowFile = `${sharedImports}
import { AdminEscrowAction, ResolveOrderEscrowDto } from '../../dto/admin-order.dto';
import { FeeCalculatorService } from '../../../fees/fee-calculator.service';
import { OrderReputationService } from '../../../orders/order-reputation.service';
import { WalletService } from '../../../wallet/wallet.service';
import { ListingCommandService } from '../../../listing/services/listing-command.service';
import {
  buildOrderTicketSubject,
  formatTicketMessageBody,
} from '../../../../common/ticket-message.util';
import { AdminOrdersNotifyService } from './admin-orders-notify.service';

@Injectable()
export class AdminOrdersEscrowService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly feeCalculator: FeeCalculatorService,
    private readonly orderReputation: OrderReputationService,
    private readonly walletService: WalletService,
    private readonly listingCommand: ListingCommandService,
    private readonly notify: AdminOrdersNotifyService,
  ) {}

${escrowBodyFixed}
}
`;

const publicMethods = [
  ['repairBuyerRefundForCancelledOrder', 'status'],
  ['updateStatus', 'status'],
  ['setHubShippingCodes', 'hub'],
  ['setTrackingCode', 'hub'],
  ['setParticipantShipping', 'hub'],
  ['setExchangeHubReceipt', 'hub'],
  ['finalizeExchangeHubInspection', 'inspection'],
  ['resolveEscrow', 'escrow'],
  ['rejectExchangeFakeShipment', 'inspection'],
];

const svcType = {
  status: 'AdminOrdersStatusService',
  hub: 'AdminOrdersHubService',
  inspection: 'AdminOrdersInspectionService',
  escrow: 'AdminOrdersEscrowService',
};

const facadeMethods = publicMethods
  .map(([name, svc]) => {
    return `  ${name}(...args: Parameters<${svcType[svc]}['${name}']>) {
    return this.${svc}.${name}(...args);
  }`;
  })
  .join('\n\n');

const facadeFile = `import { Injectable } from '@nestjs/common';
import { OrderStatus } from '@prisma/client';
import {
  FinalizeExchangeHubInspectionDto,
  RejectExchangeFakeShipmentDto,
  ResolveOrderEscrowDto,
  SetExchangeHubReceiptDto,
  SetHubShippingCodesDto,
  SetParticipantShippingDto,
} from '../dto/admin-order.dto';
import { AdminOrdersStatusService } from './orders-command/admin-orders-status.service';
import { AdminOrdersHubService } from './orders-command/admin-orders-hub.service';
import { AdminOrdersInspectionService } from './orders-command/admin-orders-inspection.service';
import { AdminOrdersEscrowService } from './orders-command/admin-orders-escrow.service';

/**
 * Backward-compatible facade. Prefer injecting specialized services directly.
 */
@Injectable()
export class AdminOrdersCommandService {
  constructor(
    private readonly status: AdminOrdersStatusService,
    private readonly hub: AdminOrdersHubService,
    private readonly inspection: AdminOrdersInspectionService,
    private readonly escrow: AdminOrdersEscrowService,
  ) {}

${facadeMethods}
}
`;

const out = (rel, content) => {
  const p = path.join(root, rel);
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, content, 'utf8');
  console.log('wrote', rel, content.split('\n').length, 'lines');
};

out('src/modules/admin/services/admin-orders.constants.ts', constantsFile);
out(
  'src/modules/admin/services/orders-command/admin-orders-notify.service.ts',
  notifyFile,
);
out(
  'src/modules/admin/services/orders-command/admin-orders-status.service.ts',
  statusFile,
);
out(
  'src/modules/admin/services/orders-command/admin-orders-hub.service.ts',
  hubFile,
);
out(
  'src/modules/admin/services/orders-command/admin-orders-inspection.service.ts',
  inspectionFile,
);
out(
  'src/modules/admin/services/orders-command/admin-orders-escrow.service.ts',
  escrowFile,
);
out('src/modules/admin/services/admin-orders-command.service.ts', facadeFile);

console.log('done — update admin.module.ts providers manually');
