import 'reflect-metadata';
import { OrderStatus } from '@prisma/client';
import {
  AdminEscrowAction,
  ResolveOrderEscrowDto,
} from '../dto/admin-order.dto';
import { FinalizeExchangeHubInspectionDto } from '../dto/admin-order.dto';
import { AdminOrdersCommandService } from './admin-orders-command.service';
import { AdminOrdersNotifyService } from './orders-command/admin-orders-notify.service';
import { AdminOrdersStatusService } from './orders-command/admin-orders-status.service';
import { AdminOrdersHubService } from './orders-command/admin-orders-hub.service';
import { AdminOrdersInspectionService } from './orders-command/admin-orders-inspection.service';
import { AdminOrdersEscrowService } from './orders-command/admin-orders-escrow.service';

function createAdminOrdersCommandService(deps: {
  prisma: unknown;
  appSettings?: unknown;
  feeCalculator?: unknown;
  orderReputation: unknown;
  walletService: unknown;
  ordersService?: unknown;
  listingCommand: unknown;
  stateMachine?: unknown;
}) {
  const appSettings =
    deps.appSettings ??
    ({ getApiUrl: jest.fn().mockReturnValue('https://api.example.com') } as const);
  const feeCalculator = deps.feeCalculator ?? {};
  const ordersService =
    deps.ordersService ?? ({ ensureBuyerConfirmDeadline: jest.fn() } as const);
  const stateMachine =
    deps.stateMachine ?? ({ assertTransition: jest.fn() } as const);

  const notify = new AdminOrdersNotifyService(deps.prisma as never);
  const status = new AdminOrdersStatusService(
    deps.prisma as never,
    appSettings as never,
    deps.orderReputation as never,
    deps.walletService as never,
    ordersService as never,
    deps.listingCommand as never,
    stateMachine as never,
    notify,
  );
  const hub = new AdminOrdersHubService(
    deps.prisma as never,
    deps.orderReputation as never,
    deps.walletService as never,
    ordersService as never,
    deps.listingCommand as never,
  );
  const inspection = new AdminOrdersInspectionService(
    deps.prisma as never,
    appSettings as never,
    feeCalculator as never,
    deps.orderReputation as never,
    deps.walletService as never,
    deps.listingCommand as never,
    notify,
  );
  const escrow = new AdminOrdersEscrowService(
    deps.prisma as never,
    feeCalculator as never,
    deps.orderReputation as never,
    deps.walletService as never,
    deps.listingCommand as never,
    notify,
  );
  return new AdminOrdersCommandService(status, hub, inspection, escrow);
}

describe('AdminOrdersCommandService - exchange financial settlement', () => {
  const makeOrder = () => ({
    id: 'ord-1',
    type: 'EXCHANGE',
    status: OrderStatus.CHECKING_AT_HUB,
    exchangeHubInspection: {},
    verificationFee: 0,
    totalAmount: 1000,
    sellerRevenue: 300,
    exchangeOfferId: 'offer-1',
    buyerId: 'buyer-1',
    sellerId: 'seller-1',
    trackingCode: 'TRK-B',
    sellerTrackingCode: 'TRK-S',
    packagingVideo: null,
    buyerPackagingVideo: null,
    listing: { id: 'lst-1', title: 'listing title' },
  });

  const makeDto = (): FinalizeExchangeHubInspectionDto => ({
    listingItem: 'PASS_WITH_SETTLEMENT' as const,
    offerItem: 'PASS' as const,
    resolution: 'FINANCIAL_SETTLEMENT_THEN_SHIP' as const,
    listingNote: 'listing settle',
    offerNote: 'ok',
    listingSettlementAmount: 0,
    listingSettlementDirection: 'DEBIT' as const,
    offerSettlementAmount: 0,
    offerSettlementDirection: 'DEBIT' as const,
  });

  function makeService(params?: {
    offerExtraPayment?: number;
    offerIsPayerMe?: boolean;
    buyerBlocked?: number;
    buyerAvailable?: number;
    sellerBlocked?: number;
    sellerAvailable?: number;
  }) {
    const tx = {
      exchangeOffer: {
        findUnique: jest.fn().mockResolvedValue({
          extraPayment: params?.offerExtraPayment ?? 200,
          isPayerMe: params?.offerIsPayerMe ?? false,
        }),
      },
      wallet: {
        upsert: jest
          .fn()
          .mockImplementation(
            async ({ where }: { where: { userId: string } }) => {
              if (where.userId === 'buyer-1') {
                return {
                  balanceBlocked: params?.buyerBlocked ?? 200,
                  balanceAvailable: params?.buyerAvailable ?? 500,
                };
              }
              return {
                balanceBlocked: params?.sellerBlocked ?? 0,
                balanceAvailable: params?.sellerAvailable ?? 500,
              };
            },
          ),
        update: jest.fn().mockResolvedValue({}),
      },
      walletTransaction: {
        create: jest.fn().mockResolvedValue({}),
      },
      order: {
        update: jest.fn().mockResolvedValue({
          id: 'ord-1',
          status: OrderStatus.VERIFIED_AT_HUB,
        }),
      },
    };

    const prisma = {
      order: {
        findUnique: jest.fn().mockResolvedValue(makeOrder()),
        update: jest.fn().mockResolvedValue({
          id: 'ord-1',
          status: OrderStatus.CHECKING_AT_HUB,
        }),
      },
      notification: { createMany: jest.fn().mockResolvedValue({ count: 2 }) },
      ticket: { create: jest.fn().mockResolvedValue({ id: 'ticket-1' }) },
      $transaction: jest.fn(async (cb: (trx: typeof tx) => Promise<unknown>) =>
        cb(tx),
      ),
    };

    const appSettings = {
      getApiUrl: jest.fn().mockReturnValue('https://api.example.com'),
    };
    const feeCalculator = {};
    const orderReputation = {
      recordTerminalOutcome: jest.fn().mockResolvedValue(undefined),
    };
    const walletService = {
      repairMissingDirectCancelRefund: jest
        .fn()
        .mockResolvedValue({ repaired: false }),
      resolveOrderScopedCap: jest.fn(async (_tx, params) =>
        Math.max(0, Number(params.requestedAmount) || 0),
      ),
      getOrderScopedBlockedAmount: jest.fn(async () => 200),
    };
    const ordersService = {
      ensureBuyerConfirmDeadline: jest.fn().mockResolvedValue(undefined),
    };
    const listingCommand = {
      rejectAfterTradeFailure: jest.fn().mockResolvedValue(undefined),
    };
    const stateMachine = {
      assertTransition: jest.fn(),
    };

    const service = createAdminOrdersCommandService({
      prisma,
      appSettings,
      feeCalculator,
      orderReputation,
      walletService,
      ordersService,
      listingCommand,
      stateMachine,
    });
    return { service, prisma, tx };
  }

  it('deducts only buyer blocked amount when settlement fits blocked escrow', async () => {
    const { service, tx } = makeService({
      offerExtraPayment: 200,
      offerIsPayerMe: false,
      buyerBlocked: 200,
      buyerAvailable: 500,
    });
    const dto = makeDto();
    dto.listingSettlementAmount = 100;
    dto.listingSettlementDirection = 'DEBIT';

    await service.finalizeExchangeHubInspection('ord-1', dto);

    // settlement direction=DEBIT => seller pays buyer (deduct from seller, credit buyer blocked)
    expect(tx.wallet.update).toHaveBeenCalledWith({
      where: { userId: 'seller-1' },
      data: { balanceAvailable: { decrement: 100 } },
    });
    expect(tx.wallet.update).toHaveBeenCalledWith({
      where: { userId: 'buyer-1' },
      data: { balanceBlocked: { increment: 100 } },
    });
    expect(tx.order.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          sellerRevenue: 200,
          status: OrderStatus.VERIFIED_AT_HUB,
        }),
      }),
    );
  });

  it('deducts blocked then available when blocked is not enough', async () => {
    const { service, tx } = makeService({
      offerExtraPayment: 200,
      offerIsPayerMe: false,
      buyerBlocked: 200,
      buyerAvailable: 500,
    });
    const dto = makeDto();
    dto.listingSettlementAmount = 350;
    dto.listingSettlementDirection = 'DEBIT';

    await service.finalizeExchangeHubInspection('ord-1', dto);

    expect(tx.wallet.update).toHaveBeenCalledWith({
      where: { userId: 'seller-1' },
      data: {
        balanceAvailable: { decrement: 350 },
      },
    });
    expect(tx.wallet.update).toHaveBeenCalledWith({
      where: { userId: 'buyer-1' },
      data: {
        balanceBlocked: { increment: 350 },
      },
    });
    expect(tx.order.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ sellerRevenue: 0 }),
      }),
    );
  });

  it('marks order awaiting wallet topup when available balance is insufficient', async () => {
    const { service, prisma } = makeService({
      offerExtraPayment: 200,
      offerIsPayerMe: false,
      buyerBlocked: 200,
      buyerAvailable: 40,
      sellerAvailable: 40,
    });
    const dto = makeDto();
    dto.listingSettlementAmount = 350;
    dto.listingSettlementDirection = 'DEBIT';

    await service.finalizeExchangeHubInspection('ord-1', dto);

    expect(prisma.order.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'ord-1' },
        data: expect.objectContaining({
          status: OrderStatus.CHECKING_AT_HUB,
          exchangeHubInspection: expect.objectContaining({
            awaitingFinanceSettlement: true,
          }),
        }),
      }),
    );
  });

  it('handles reverse settlement from seller to buyer using seller blocked then available', async () => {
    const { service, tx } = makeService({
      offerExtraPayment: 250,
      offerIsPayerMe: true,
      sellerBlocked: 250,
      sellerAvailable: 300,
    });
    const dto = makeDto();
    dto.offerItem = 'PASS_WITH_SETTLEMENT';
    dto.offerSettlementAmount = 300;
    dto.offerSettlementDirection = 'DEBIT';
    dto.offerNote = 'offer settle';
    dto.listingItem = 'PASS';
    dto.listingNote = 'ok';
    dto.listingSettlementAmount = 0;

    await service.finalizeExchangeHubInspection('ord-1', dto);

    // offer settlement DEBIT => buyer pays seller (deduct from buyer, credit seller blocked)
    expect(tx.wallet.update).toHaveBeenCalledWith({
      where: { userId: 'buyer-1' },
      data: {
        balanceAvailable: { decrement: 300 },
      },
    });
    expect(tx.wallet.update).toHaveBeenCalledWith({
      where: { userId: 'seller-1' },
      data: {
        balanceBlocked: { increment: 300 },
      },
    });
    expect(tx.order.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ sellerRevenue: 600 }),
      }),
    );
  });
});

describe('AdminOrdersCommandService - exchange hub return inspection', () => {
  function makeReturnService(dto: FinalizeExchangeHubInspectionDto) {
    const orderRecord = {
      id: 'ord-ret-1',
      type: 'EXCHANGE',
      status: OrderStatus.CHECKING_AT_HUB,
      exchangeHubInspection: {},
      verificationFee: 100,
      totalAmount: 500,
      sellerRevenue: 200,
      exchangeOfferId: 'offer-1',
      buyerId: 'buyer-1',
      sellerId: 'seller-1',
      tradeReputationAt: null,
      trackingCode: 'TRK-S',
      sellerTrackingCode: 'TRK-B',
      packagingVideo: null,
      buyerPackagingVideo: null,
      listing: { id: 'lst-1', title: 'listing title' },
    };

    const tx = {
      order: {
        update: jest.fn().mockResolvedValue({
          id: orderRecord.id,
          status: OrderStatus.REJECTED_AT_HUB,
        }),
      },
      ticket: {
        create: jest.fn().mockImplementation(
          async ({
            data,
          }: {
            data: {
              userId: string;
              messages: { create: { message: string } };
            };
          }) => ({
            id: `ticket-${data.userId}`,
          }),
        ),
      },
      notification: { create: jest.fn().mockResolvedValue({}) },
      listing: { update: jest.fn().mockResolvedValue({}) },
    };

    const prisma = {
      order: { findUnique: jest.fn().mockResolvedValue(orderRecord) },
      notification: { createMany: jest.fn().mockResolvedValue({ count: 2 }) },
      systemSetting: {
        findFirst: jest.fn().mockResolvedValue(null),
        findMany: jest.fn().mockResolvedValue([]),
      },
      $transaction: jest.fn(async (cb: (trx: typeof tx) => Promise<unknown>) =>
        cb(tx),
      ),
    };

    const orderReputation = {
      recordTerminalOutcome: jest.fn().mockResolvedValue(undefined),
    };
    const listingCommand = {
      rejectAfterTradeFailure: jest.fn().mockResolvedValue(undefined),
    };

    const service = createAdminOrdersCommandService({
      prisma,
      orderReputation,
      walletService: {
        repairMissingDirectCancelRefund: jest.fn(),
        applyExchangeHubInspectionOutcomeRefunds: jest.fn().mockResolvedValue({
          buyerRefundAmount: 80_000,
          sellerRefundAmount: 280_000,
        }),
      },
      listingCommand,
      stateMachine: { assertTransition: jest.fn() },
    });

    return { service, tx, orderReputation, listingCommand, dto, prisma };
  }

  it('penalizes only the failed side when one item passes and one fails', async () => {
    const dto: FinalizeExchangeHubInspectionDto = {
      listingItem: 'PASS',
      offerItem: 'FAIL',
      resolution: 'RETURN_BOTH_TO_SENDERS',
      listingNote: 'ok',
      offerNote: 'defect',
      listingSettlementAmount: 0,
      listingSettlementDirection: 'DEBIT',
      offerSettlementAmount: 0,
      offerSettlementDirection: 'DEBIT',
    };
    const { service, orderReputation } = makeReturnService(dto);

    await service.finalizeExchangeHubInspection('ord-ret-1', dto);

    expect(orderReputation.recordTerminalOutcome).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ id: 'ord-ret-1' }),
      OrderStatus.CHECKING_AT_HUB,
      'FAILURE',
      { failurePenalizeUserIds: ['buyer-1'] },
    );
  });

  it('penalizes both sides when both items fail', async () => {
    const dto: FinalizeExchangeHubInspectionDto = {
      listingItem: 'FAIL',
      offerItem: 'FAIL',
      resolution: 'RETURN_BOTH_TO_SENDERS',
      listingNote: 'bad listing',
      offerNote: 'bad offer',
      listingSettlementAmount: 0,
      listingSettlementDirection: 'DEBIT',
      offerSettlementAmount: 0,
      offerSettlementDirection: 'DEBIT',
    };
    const { service, orderReputation, listingCommand } = makeReturnService(dto);

    await service.finalizeExchangeHubInspection('ord-ret-1', dto);

    expect(orderReputation.recordTerminalOutcome).toHaveBeenCalledWith(
      expect.anything(),
      expect.anything(),
      OrderStatus.CHECKING_AT_HUB,
      'FAILURE',
      { failurePenalizeUserIds: ['seller-1', 'buyer-1'] },
    );
    expect(listingCommand.rejectAfterTradeFailure).toHaveBeenCalled();
  });
});

describe('AdminOrdersCommandService - exchange release escrow', () => {
  function makeReleaseService(
    orderOverrides?: Partial<Record<string, unknown>>,
  ) {
    const orderRecord = {
      id: 'ord-release-1',
      type: 'EXCHANGE',
      buyerId: 'buyer-1',
      sellerId: 'seller-1',
      listingId: 'lst-1',
      listing: {
        title: 'listing title',
        sellerRequiresVerification: true,
        categoryId: 'cat-1',
      },
      finalPrice: 0,
      status: OrderStatus.SHIPPED_TO_BUYER,
      sellerRevenue: 400,
      totalAmount: 500,
      platformFee: 0,
      shippingCost: 0,
      verificationFee: 20,
      requiresVerification: true,
      exchangeOfferId: 'offer-1',
      returnTrackingCode: null,
      exchangeHubInspection: {},
      ...orderOverrides,
    };

    const tx = {
      order: {
        findUnique: jest.fn().mockResolvedValue(orderRecord),
        update: jest.fn().mockResolvedValue({
          id: orderRecord.id,
          status: OrderStatus.COMPLETED,
        }),
      },
      exchangeOffer: {
        findUnique: jest
          .fn()
          .mockResolvedValue({ extraPayment: 500, isPayerMe: false }),
      },
      wallet: {
        upsert: jest.fn().mockResolvedValue({}),
      },
      walletTransaction: {
        create: jest.fn().mockResolvedValue({}),
      },
      notification: {
        createMany: jest.fn().mockResolvedValue({ count: 2 }),
      },
    };

    const prisma = {
      $transaction: jest.fn(async (cb: (trx: typeof tx) => Promise<unknown>) =>
        cb(tx),
      ),
      notification: {
        createMany: jest.fn().mockResolvedValue({ count: 2 }),
      },
    };
    const appSettings = {
      getApiUrl: jest.fn().mockReturnValue('https://api.example.com'),
    };
    const feeCalculator = {};
    const orderReputation = {
      recordTerminalOutcome: jest.fn().mockResolvedValue(undefined),
    };
    const walletService = {
      repairMissingDirectCancelRefund: jest
        .fn()
        .mockResolvedValue({ repaired: false }),
      resolveOrderScopedCap: jest.fn(async (_tx, params) =>
        Math.max(0, Number(params.requestedAmount) || 0),
      ),
      releaseEscrow: jest.fn().mockResolvedValue(undefined),
    };
    const ordersService = {
      ensureBuyerConfirmDeadline: jest.fn().mockResolvedValue(undefined),
    };
    const listingCommand = {
      rejectAfterTradeFailure: jest.fn().mockResolvedValue(undefined),
    };
    const service = createAdminOrdersCommandService({
      prisma,
      appSettings,
      feeCalculator,
      orderReputation,
      walletService,
      ordersService,
      listingCommand,
      stateMachine: { assertTransition: jest.fn() },
    });
    return { service, tx, walletService };
  }

  it('releases only sellerRevenue for EXCHANGE (not totalAmount-verificationFee)', async () => {
    const { service, walletService } = makeReleaseService({
      sellerRevenue: 400,
      totalAmount: 500,
      verificationFee: 20,
    });
    const dto: ResolveOrderEscrowDto = {
      action: AdminEscrowAction.RELEASE_TO_SELLER,
    };

    await service.resolveEscrow('ord-release-1', dto);

    expect(walletService.releaseEscrow).toHaveBeenCalledWith(
      'seller-1',
      400,
      'lst-1',
      expect.anything(),
      { orderId: 'ord-release-1' },
    );
  });
});
