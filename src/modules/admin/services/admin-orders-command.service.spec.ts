import { BadRequestException } from '@nestjs/common';
import { OrderStatus } from '@prisma/client';
import { AdminEscrowAction, ResolveOrderEscrowDto } from '../dto/admin-order.dto';
import { FinalizeExchangeHubInspectionDto } from '../dto/admin-order.dto';
import { AdminOrdersCommandService } from './admin-orders-command.service';

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
    trackingCode: null,
    sellerTrackingCode: null,
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
          .mockImplementation(async ({ where }: { where: { userId: string } }) => {
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
          }),
        update: jest.fn().mockResolvedValue({}),
      },
      walletTransaction: {
        create: jest.fn().mockResolvedValue({}),
      },
      order: {
        update: jest.fn().mockResolvedValue({ id: 'ord-1', status: OrderStatus.VERIFIED_AT_HUB }),
      },
    };

    const prisma = {
      order: {
        findUnique: jest.fn().mockResolvedValue(makeOrder()),
      },
      notification: { createMany: jest.fn().mockResolvedValue({ count: 2 }) },
      $transaction: jest.fn(async (cb: (trx: typeof tx) => Promise<unknown>) => cb(tx)),
    };

    const appSettings = { getApiUrl: jest.fn().mockReturnValue('https://api.example.com') };
    const feeCalculator = {};

    const service = new AdminOrdersCommandService(prisma as never, appSettings as never, feeCalculator as never);
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
    dto.listingSettlementDirection = 'CREDIT';

    await service.finalizeExchangeHubInspection('ord-1', dto);

    expect(tx.wallet.update).toHaveBeenCalledWith({
      where: { userId: 'buyer-1' },
      data: { balanceBlocked: { decrement: 100 } },
    });
    expect(tx.order.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ sellerRevenue: 400, status: OrderStatus.VERIFIED_AT_HUB }),
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
    dto.listingSettlementDirection = 'CREDIT';

    await service.finalizeExchangeHubInspection('ord-1', dto);

    expect(tx.wallet.update).toHaveBeenCalledWith({
      where: { userId: 'buyer-1' },
      data: {
        balanceBlocked: { decrement: 200 },
        balanceAvailable: { decrement: 150 },
      },
    });
    expect(tx.order.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ sellerRevenue: 650 }),
      }),
    );
  });

  it('throws error when additional available balance is insufficient', async () => {
    const { service } = makeService({
      offerExtraPayment: 200,
      offerIsPayerMe: false,
      buyerBlocked: 200,
      buyerAvailable: 40,
    });
    const dto = makeDto();
    dto.listingSettlementAmount = 350;
    dto.listingSettlementDirection = 'CREDIT';

    await expect(service.finalizeExchangeHubInspection('ord-1', dto)).rejects.toBeInstanceOf(
      BadRequestException,
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
    dto.offerSettlementDirection = 'CREDIT';
    dto.offerNote = 'offer settle';
    dto.listingItem = 'PASS';
    dto.listingNote = 'ok';
    dto.listingSettlementAmount = 0;

    await service.finalizeExchangeHubInspection('ord-1', dto);

    expect(tx.wallet.update).toHaveBeenCalledWith({
      where: { userId: 'seller-1' },
      data: {
        balanceBlocked: { decrement: 250 },
        balanceAvailable: { decrement: 50 },
      },
    });
    expect(tx.order.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ sellerRevenue: 0 }),
      }),
    );
  });
});

describe('AdminOrdersCommandService - exchange release escrow', () => {
  function makeReleaseService(orderOverrides?: Partial<Record<string, unknown>>) {
    const orderRecord = {
      id: 'ord-release-1',
      type: 'EXCHANGE',
      buyerId: 'buyer-1',
      sellerId: 'seller-1',
      listingId: 'lst-1',
      listing: { title: 'listing title', sellerRequiresVerification: true, categoryId: 'cat-1' },
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
        update: jest.fn().mockResolvedValue({ id: orderRecord.id, status: OrderStatus.COMPLETED }),
      },
      exchangeOffer: {
        findUnique: jest.fn().mockResolvedValue({ extraPayment: 500, isPayerMe: false }),
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
      $transaction: jest.fn(async (cb: (trx: typeof tx) => Promise<unknown>) => cb(tx)),
      notification: {
        createMany: jest.fn().mockResolvedValue({ count: 2 }),
      },
    };
    const appSettings = { getApiUrl: jest.fn().mockReturnValue('https://api.example.com') };
    const feeCalculator = {};
    const service = new AdminOrdersCommandService(prisma as never, appSettings as never, feeCalculator as never);
    return { service, tx };
  }

  it('releases only sellerRevenue for EXCHANGE (not totalAmount-verificationFee)', async () => {
    const { service, tx } = makeReleaseService({
      sellerRevenue: 400,
      totalAmount: 500,
      verificationFee: 20,
    });
    const dto: ResolveOrderEscrowDto = { action: AdminEscrowAction.RELEASE_TO_SELLER };

    await service.resolveEscrow('ord-release-1', dto);

    expect(tx.wallet.upsert).toHaveBeenCalledWith({
      where: { userId: 'seller-1' },
      create: {
        userId: 'seller-1',
        balanceAvailable: 400,
        balanceBlocked: 0,
      },
      update: {
        balanceBlocked: { decrement: 400 },
        balanceAvailable: { increment: 400 },
      },
    });
    expect(tx.walletTransaction.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          amount: 400,
        }),
      }),
    );
  });
});
