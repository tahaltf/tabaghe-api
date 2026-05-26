/**
 * ماتریس سناریوهای معاوضه (خریدار = offerer، فروشنده = صاحب آگهی)
 *
 * | # | سناریو | مکانیزم | وضعیت سفارش | جریمه |
 * |---|--------|---------|--------------|-------|
 * | 1 | تایید، هیچ‌کس نپردازد | processExchangePaymentTimeout neither_paid | CANCELLED + paymentTimeout | هر دو |
 * | 2 | تایید، فروشنده نپردازد | buyer_paid_only | CANCELLED | فروشنده |
 * | 3 | تایید، خریدار نپردازد | seller_paid_only | CANCELLED | خریدار (+ بازگردانی صف) |
 * | 4 | هر دو پرداخت، هیچ‌کس ارسال نکند | autoCancelExpiredOrders both | CANCELLED | هر دو |
 * | 5 | هر دو پرداخت، خریدار ارسال نکند | one-side (seller sent) | REJECTED_AT_HUB | خریدار |
 * | 6 | هر دو پرداخت، فروشنده ارسال نکند | one-side (buyer sent) | REJECTED_AT_HUB | فروشنده |
 * | 7 | کارشناسی: هر دو رد | RETURN_BOTH | REJECTED_AT_HUB | هر دو |
 * | 8 | کارشناسی: کالای پیشنهاد رد | RETURN_BOTH | REJECTED_AT_HUB | خریدار |
 * | 9 | کارشناسی: کالای آگهی رد | RETURN_BOTH | REJECTED_AT_HUB | فروشنده |
 * |10 | کارشناسی: اصلاح مالی پیشنهاد | FINANCIAL_SETTLEMENT | VERIFIED_AT_HUB | — |
 * |11 | کارشناسی: اصلاح مالی آگهی | FINANCIAL_SETTLEMENT | VERIFIED_AT_HUB | — |
 * |12 | کارشناسی: هر دو تایید | SHIP_TO_DESTINATIONS | VERIFIED_AT_HUB | — |
 */
import { Test, TestingModule } from '@nestjs/testing';
import {
  ExchangeOfferStatus,
  ListingStatus,
  OrderStatus,
  OrderType,
} from '@prisma/client';
import { OrdersService } from './orders.service';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { WalletService } from '../wallet/wallet.service';
import { FeeCalculatorService } from '../fees/fee-calculator.service';
import { OrdersStateMachineService } from './orders-state-machine.service';
import { AppSettingsService } from '../../shared/settings/app-settings.service';
import { PaymentsService } from '../payments/payments.service';
import { NotificationService } from '../notification/notification.service';
import { OrderReputationService } from './order-reputation.service';
import { ExchangeService } from '../exchange/exchange.service';
import { QuotaService } from '../quota/quota.service';
import { ListingCommandService } from '../listing/services/listing-command.service';
import { FinalizeExchangeHubInspectionDto } from '../admin/dto/admin-order.dto';
import { AdminOrdersCommandService } from '../admin/services/admin-orders-command.service';

describe('Exchange lifecycle — payment timeout (scenarios 1–3)', () => {
  let service: OrdersService;

  const walletMock = {
    resolveExchangeParticipantPaidAmount: jest.fn(),
    refundExchangePaymentTimeoutOnCancel: jest
      .fn()
      .mockResolvedValue({ buyerRefund: 0, sellerRefund: 0 }),
  };
  const orderReputationMock = {
    recordTerminalOutcome: jest.fn().mockResolvedValue(undefined),
    penalizeUsers: jest.fn().mockResolvedValue(undefined),
  };
  const listingCommandMock = {
    rejectAfterTradeFailure: jest.fn().mockResolvedValue(undefined),
  };
  const prismaMock = { $transaction: jest.fn() };

  const offerBase = {
    id: 'offer-1',
    listingId: 'lst-1',
    isPayerMe: false,
    extraPayment: 200_000,
    offererId: 'buyer-1',
    listing: {
      id: 'lst-1',
      title: 'کالا',
      authorId: 'seller-1',
      status: ListingStatus.APPROVED,
    },
  };

  const linkedOrderBase = {
    id: 'ord-1',
    status: OrderStatus.AWAITING_PAYMENT,
    buyerId: 'buyer-1',
    sellerId: 'seller-1',
    tradeReputationAt: null,
    cancelReason: null,
    verificationFee: 250_000,
    totalAmount: 0,
    shippingAddress: null,
    sellerShippingAddress: null,
    exchangeHubInspection: null,
  };

  beforeEach(async () => {
    jest.clearAllMocks();
    walletMock.resolveExchangeParticipantPaidAmount.mockReset();
    walletMock.refundExchangePaymentTimeoutOnCancel.mockReset();
    walletMock.refundExchangePaymentTimeoutOnCancel.mockResolvedValue({
      buyerRefund: 0,
      sellerRefund: 0,
    });
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        OrdersService,
        { provide: PrismaService, useValue: prismaMock },
        { provide: WalletService, useValue: walletMock },
        { provide: FeeCalculatorService, useValue: {} },
        { provide: AppSettingsService, useValue: {} },
        { provide: OrdersStateMachineService, useValue: { assertTransition: jest.fn() } },
        { provide: PaymentsService, useValue: {} },
        { provide: NotificationService, useValue: {} },
        { provide: OrderReputationService, useValue: orderReputationMock },
        { provide: ExchangeService, useValue: {} },
        { provide: QuotaService, useValue: {} },
        { provide: ListingCommandService, useValue: listingCommandMock },
      ],
    }).compile();
    service = module.get(OrdersService);
  });

  async function runTimeout(
    paid: { buyer: number; seller: number },
    linkedOrder: typeof linkedOrderBase | null = linkedOrderBase,
  ) {
    walletMock.resolveExchangeParticipantPaidAmount
      .mockResolvedValueOnce(paid.buyer)
      .mockResolvedValueOnce(paid.seller);

    const tx = {
      exchangeOffer: {
        findUnique: jest.fn(),
        update: jest.fn().mockResolvedValue({}),
        updateMany: jest.fn().mockResolvedValue({ count: 0 }),
        findMany: jest.fn().mockResolvedValue([]),
      },
      order: {
        findFirst: jest.fn().mockResolvedValue(linkedOrder),
        update: jest.fn().mockResolvedValue({}),
      },
      user: { update: jest.fn().mockResolvedValue({}) },
      listing: { update: jest.fn().mockResolvedValue({}) },
      notification: { createMany: jest.fn().mockResolvedValue({ count: 0 }) },
      ticket: {
        create: jest.fn().mockResolvedValue({ id: 'ticket-1' }),
      },
    };

    prismaMock.$transaction.mockImplementation(
      async (cb: (trx: typeof tx) => Promise<unknown>) => cb(tx),
    );

    await (
      service as unknown as {
        processExchangePaymentTimeoutInTx: (
          tx: object,
          offer: typeof offerBase,
        ) => Promise<void>;
      }
    ).processExchangePaymentTimeoutInTx(tx, offerBase);

    return tx;
  }

  it('scenario 1: accepted — neither party pays → CANCELLED, both penalized, listing rejected', async () => {
    const tx = await runTimeout({ buyer: 0, seller: 0 });

    expect(tx.order.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          status: OrderStatus.CANCELLED,
          exchangeHubInspection: expect.objectContaining({
            paymentTimeout: true,
          }),
        }),
      }),
    );
    expect(tx.user.update).toHaveBeenCalledTimes(2);
    expect(tx.exchangeOffer.update).toHaveBeenCalledWith({
      where: { id: 'offer-1' },
      data: { status: ExchangeOfferStatus.CANCELLED },
    });
    expect(listingCommandMock.rejectAfterTradeFailure).toHaveBeenCalled();
  });

  it('scenario 2: accepted — buyer paid, seller did not → seller offender', async () => {
    const tx = await runTimeout(
      { buyer: 250_000, seller: 0 },
      {
        ...linkedOrderBase,
        totalAmount: 250_000,
        shippingAddress: 'تهران، آدرس خریدار',
        sellerShippingAddress: null,
      },
    );

    expect(walletMock.resolveExchangeParticipantPaidAmount).toHaveBeenCalled();

    expect(tx.order.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          cancelReason: expect.stringContaining('فروشنده'),
        }),
      }),
    );
    expect(tx.user.update).toHaveBeenCalledTimes(1);
    expect(tx.user.update).toHaveBeenCalledWith({
      where: { id: 'seller-1' },
      data: expect.objectContaining({ trustScore: { decrement: expect.any(Number) } }),
    });
    expect(listingCommandMock.rejectAfterTradeFailure).toHaveBeenCalled();
  });

  it('scenario 3: accepted — seller paid, buyer did not → buyer offender, waitlist restored', async () => {
    const tx = await runTimeout(
      { buyer: 0, seller: 450_000 },
      {
        ...linkedOrderBase,
        totalAmount: 700_000,
        shippingAddress: null,
        sellerShippingAddress: 'تهران، آدرس فروشنده',
      },
    );

    expect(tx.order.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          cancelReason: expect.stringContaining('پیشنهاددهنده'),
        }),
      }),
    );
    expect(tx.user.update).toHaveBeenCalledWith({
      where: { id: 'buyer-1' },
      data: expect.objectContaining({ trustScore: { decrement: expect.any(Number) } }),
    });
    expect(tx.listing.update).toHaveBeenCalledWith({
      where: { id: 'lst-1' },
      data: { status: ListingStatus.APPROVED },
    });
    expect(tx.exchangeOffer.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          status: ExchangeOfferStatus.WAITLISTED,
        }),
        data: { status: ExchangeOfferStatus.PENDING },
      }),
    );
    expect(listingCommandMock.rejectAfterTradeFailure).not.toHaveBeenCalled();
  });
});

describe('Exchange lifecycle — hub inspection (scenarios 7–12)', () => {
  function makeHubService(
    dto: FinalizeExchangeHubInspectionDto,
    orderOverrides?: Record<string, unknown>,
  ) {
    const orderRecord = {
      id: 'ord-hub-1',
      type: OrderType.EXCHANGE,
      status: OrderStatus.CHECKING_AT_HUB,
      exchangeHubInspection: {},
      verificationFee: 100,
      totalAmount: 500,
      sellerRevenue: 200,
      exchangeOfferId: 'offer-1',
      buyerId: 'buyer-1',
      sellerId: 'seller-1',
      tradeReputationAt: null,
      trackingCode: 'S'.repeat(24),
      sellerTrackingCode: 'B'.repeat(24),
      packagingVideo: 'v1.mp4',
      buyerPackagingVideo: 'v2.mp4',
      listing: { id: 'lst-1', title: 'آگهی' },
      ...orderOverrides,
    };

    const tx = {
      exchangeOffer: {
        findUnique: jest
          .fn()
          .mockResolvedValue({ extraPayment: 200, isPayerMe: false }),
      },
      wallet: {
        upsert: jest.fn().mockImplementation(
          async ({ where }: { where: { userId: string } }) => ({
            balanceBlocked: where.userId === 'buyer-1' ? 500_000 : 200_000,
            balanceAvailable: 500_000,
          }),
        ),
        findUnique: jest.fn().mockImplementation(
          async ({ where }: { where: { userId: string } }) => ({
            balanceBlocked: where.userId === 'buyer-1' ? 500_000 : 200_000,
            balanceAvailable: 500_000,
          }),
        ),
        update: jest.fn().mockResolvedValue({}),
      },
      walletTransaction: { create: jest.fn().mockResolvedValue({}) },
      order: {
        update: jest.fn().mockImplementation(async ({ data }) => ({
          id: orderRecord.id,
          status: data.status,
        })),
      },
      ticket: {
        create: jest.fn().mockResolvedValue({ id: 'ticket-1' }),
      },
      notification: { create: jest.fn().mockResolvedValue({}) },
    };

    const prisma = {
      order: {
        findUnique: jest.fn().mockResolvedValue(orderRecord),
        update: jest.fn().mockImplementation(async ({ data }) => ({
          id: orderRecord.id,
          status: data.status,
        })),
      },
      systemSetting: {
        findFirst: jest.fn().mockResolvedValue({ value: '10' }),
      },
      notification: { createMany: jest.fn().mockResolvedValue({ count: 2 }) },
      $transaction: jest.fn(async (cb: (trx: typeof tx) => Promise<unknown>) =>
        cb(tx),
      ),
    };

    const walletService = {
      repairMissingDirectCancelRefund: jest
        .fn()
        .mockResolvedValue({ repaired: false }),
      applyExchangeHubInspectionOutcomeRefunds: jest
        .fn()
        .mockResolvedValue(undefined),
    };

    const orderReputation = {
      recordTerminalOutcome: jest.fn().mockResolvedValue(undefined),
    };
    const listingCommand = {
      rejectAfterTradeFailure: jest.fn().mockResolvedValue(undefined),
    };

    const hubService = new AdminOrdersCommandService(
      prisma as never,
      { getApiUrl: jest.fn().mockReturnValue('https://api.test') } as never,
      {} as never,
      orderReputation as never,
      walletService as never,
      { ensureBuyerConfirmDeadline: jest.fn() } as never,
      listingCommand as never,
    );

    return {
      hubService,
      tx,
      prisma,
      orderReputation,
      listingCommand,
      dto,
      walletService,
    };
  }

  it('scenario 7: both items FAIL → REJECTED_AT_HUB, both penalized', async () => {
    const dto: FinalizeExchangeHubInspectionDto = {
      listingItem: 'FAIL',
      offerItem: 'FAIL',
      resolution: 'RETURN_BOTH_TO_SENDERS',
      listingNote: 'رد آگهی',
      offerNote: 'رد پیشنهاد',
      listingSettlementAmount: 0,
      listingSettlementDirection: 'DEBIT',
      offerSettlementAmount: 0,
      offerSettlementDirection: 'DEBIT',
    };
    const { hubService, orderReputation } = makeHubService(dto);
    await hubService.finalizeExchangeHubInspection('ord-hub-1', dto);
    expect(orderReputation.recordTerminalOutcome).toHaveBeenCalledWith(
      expect.anything(),
      expect.anything(),
      OrderStatus.CHECKING_AT_HUB,
      'FAILURE',
      { failurePenalizeUserIds: ['seller-1', 'buyer-1'] },
    );
  });

  it('scenario 8: offer item FAIL (buyer goods) → penalize buyer only', async () => {
    const dto: FinalizeExchangeHubInspectionDto = {
      listingItem: 'PASS',
      offerItem: 'FAIL',
      resolution: 'RETURN_BOTH_TO_SENDERS',
      listingNote: 'ok',
      offerNote: 'رد',
      listingSettlementAmount: 0,
      listingSettlementDirection: 'DEBIT',
      offerSettlementAmount: 0,
      offerSettlementDirection: 'DEBIT',
    };
    const { hubService, orderReputation } = makeHubService(dto);
    await hubService.finalizeExchangeHubInspection('ord-hub-1', dto);
    expect(orderReputation.recordTerminalOutcome).toHaveBeenCalledWith(
      expect.anything(),
      expect.anything(),
      OrderStatus.CHECKING_AT_HUB,
      'FAILURE',
      { failurePenalizeUserIds: ['buyer-1'] },
    );
  });

  it('scenario 9: listing item FAIL (seller goods) → penalize seller only', async () => {
    const dto: FinalizeExchangeHubInspectionDto = {
      listingItem: 'FAIL',
      offerItem: 'PASS',
      resolution: 'RETURN_BOTH_TO_SENDERS',
      listingNote: 'رد',
      offerNote: 'ok',
      listingSettlementAmount: 0,
      listingSettlementDirection: 'DEBIT',
      offerSettlementAmount: 0,
      offerSettlementDirection: 'DEBIT',
    };
    const { hubService, orderReputation } = makeHubService(dto);
    await hubService.finalizeExchangeHubInspection('ord-hub-1', dto);
    expect(orderReputation.recordTerminalOutcome).toHaveBeenCalledWith(
      expect.anything(),
      expect.anything(),
      OrderStatus.CHECKING_AT_HUB,
      'FAILURE',
      { failurePenalizeUserIds: ['seller-1'] },
    );
  });

  it('scenario 10: offer item financial settlement (buyer side)', async () => {
    const dto: FinalizeExchangeHubInspectionDto = {
      listingItem: 'PASS',
      offerItem: 'PASS_WITH_SETTLEMENT',
      resolution: 'FINANCIAL_SETTLEMENT_THEN_SHIP',
      listingNote: 'ok',
      offerNote: 'اصلاح',
      listingSettlementAmount: 0,
      listingSettlementDirection: 'DEBIT',
      offerSettlementAmount: 50_000,
      offerSettlementDirection: 'DEBIT',
    };
    const { hubService, tx } = makeHubService(dto);
    await hubService.finalizeExchangeHubInspection('ord-hub-1', dto);
    expect(tx.order.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          status: OrderStatus.VERIFIED_AT_HUB,
        }),
      }),
    );
  });

  it('scenario 11: listing item financial settlement (seller side)', async () => {
    const dto: FinalizeExchangeHubInspectionDto = {
      listingItem: 'PASS_WITH_SETTLEMENT',
      offerItem: 'PASS',
      resolution: 'FINANCIAL_SETTLEMENT_THEN_SHIP',
      listingNote: 'اصلاح',
      offerNote: 'ok',
      listingSettlementAmount: 80_000,
      listingSettlementDirection: 'DEBIT',
      offerSettlementAmount: 0,
      offerSettlementDirection: 'DEBIT',
    };
    const { hubService, tx } = makeHubService(dto, {
      sellerRevenue: 200,
    });
    await hubService.finalizeExchangeHubInspection('ord-hub-1', dto);
    expect(tx.order.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          status: OrderStatus.VERIFIED_AT_HUB,
        }),
      }),
    );
  });

  it('scenario 12: both PASS → SHIP_TO_DESTINATIONS → VERIFIED_AT_HUB', async () => {
    const dto: FinalizeExchangeHubInspectionDto = {
      listingItem: 'PASS',
      offerItem: 'PASS',
      resolution: 'SHIP_TO_DESTINATIONS',
      listingNote: 'ok',
      offerNote: 'ok',
      listingSettlementAmount: 0,
      listingSettlementDirection: 'DEBIT',
      offerSettlementAmount: 0,
      offerSettlementDirection: 'DEBIT',
    };
    const { hubService, prisma } = makeHubService(dto);
    await hubService.finalizeExchangeHubInspection('ord-hub-1', dto);
    expect(prisma.order.update).toHaveBeenCalledWith({
      where: { id: 'ord-hub-1' },
      data: expect.objectContaining({
        status: OrderStatus.VERIFIED_AT_HUB,
        exchangeHubInspection: expect.objectContaining({
          resolution: 'SHIP_TO_DESTINATIONS',
        }),
      }),
    });
  });
});

describe('Exchange lifecycle — shipping timeout (scenarios 4–6)', () => {
  it('documents coverage in orders.service.spec.ts (autoCancelExpiredOrders)', () => {
    expect(true).toBe(true);
  });
});
