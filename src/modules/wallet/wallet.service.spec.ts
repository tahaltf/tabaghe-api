import { WalletService } from './wallet.service';
import { WalletTransactionStatus, WalletTransactionType } from '@prisma/client';

describe('WalletService - refundExchangeExtraOnCancel', () => {
  const prismaMock = {} as any;
  const notificationMock = {} as any;

  it('isPayerMe=true: برگرداندن مابه‌التفاوت به خریدار (برداشت از بلوکه فروشنده + واریز به کیف پول خریدار)', async () => {
    const service = new WalletService(prismaMock, notificationMock);

    const tx: any = {
      wallet: {
        upsert: jest.fn().mockResolvedValue({}),
        findUnique: jest.fn(async ({ where }: any) => ({
          id: `${where.userId}-wallet-id`,
        })),
      },
      walletTransaction: {
        create: jest.fn().mockResolvedValue({}),
      },
    };

    const params = {
      buyerId: 'buyer-1',
      sellerId: 'seller-1',
      listingId: 'lst-1',
      orderId: 'ord-1',
      isPayerMe: true,
      buyerRefundable: 200,
      sellerRefundable: 0,
    };

    await service.refundExchangeExtraOnCancel(tx, params);

    // فروشنده: برداشت از blocked
    expect(tx.wallet.upsert).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        where: { userId: 'seller-1' },
        update: { balanceBlocked: { decrement: 200 } },
      }),
    );

    // خریدار: افزایش موجودی قابل برداشت
    expect(tx.wallet.upsert).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        where: { userId: 'buyer-1' },
        update: { balanceAvailable: { increment: 200 } },
      }),
    );

    // دو تراکنش: seller PENALTY و buyer REFUND
    expect(tx.walletTransaction.create).toHaveBeenCalledTimes(2);

    const [sellerTx, buyerTx] = tx.walletTransaction.create.mock.calls.map(
      (c: any) => c[0],
    );

    expect(sellerTx.data.walletId).toBe('seller-1-wallet-id');
    expect(sellerTx.data.type).toBe(WalletTransactionType.PENALTY);
    expect(sellerTx.data.amount).toBe(200);
    expect(sellerTx.data.status).toBe(WalletTransactionStatus.SUCCESS);

    expect(buyerTx.data.walletId).toBe('buyer-1-wallet-id');
    expect(buyerTx.data.type).toBe(WalletTransactionType.REFUND);
    expect(buyerTx.data.amount).toBe(200);
    expect(buyerTx.data.status).toBe(WalletTransactionStatus.SUCCESS);
  });

  it('isPayerMe=false: برگرداندن مابه‌التفاوت به فروشنده (برداشت از بلوکه خریدار + واریز به کیف پول فروشنده)', async () => {
    const service = new WalletService(prismaMock, notificationMock);

    const tx: any = {
      wallet: {
        upsert: jest.fn().mockResolvedValue({}),
        findUnique: jest.fn(async ({ where }: any) => ({
          id: `${where.userId}-wallet-id`,
        })),
      },
      walletTransaction: {
        create: jest.fn().mockResolvedValue({}),
      },
    };

    const params = {
      buyerId: 'buyer-1',
      sellerId: 'seller-1',
      listingId: 'lst-1',
      orderId: 'ord-1',
      isPayerMe: false,
      buyerRefundable: 0,
      sellerRefundable: 123,
    };

    await service.refundExchangeExtraOnCancel(tx, params);

    // خریدار: برداشت از blocked
    expect(tx.wallet.upsert).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        where: { userId: 'buyer-1' },
        update: { balanceBlocked: { decrement: 123 } },
      }),
    );

    // فروشنده: افزایش موجودی قابل برداشت
    expect(tx.wallet.upsert).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        where: { userId: 'seller-1' },
        update: { balanceAvailable: { increment: 123 } },
      }),
    );

    expect(tx.walletTransaction.create).toHaveBeenCalledTimes(2);
    const [buyerTx, sellerTx] = tx.walletTransaction.create.mock.calls.map(
      (c: any) => c[0],
    );

    expect(buyerTx.data.walletId).toBe('buyer-1-wallet-id');
    expect(buyerTx.data.type).toBe(WalletTransactionType.PENALTY);
    expect(buyerTx.data.amount).toBe(123);

    expect(sellerTx.data.walletId).toBe('seller-1-wallet-id');
    expect(sellerTx.data.type).toBe(WalletTransactionType.REFUND);
    expect(sellerTx.data.amount).toBe(123);
  });
});

describe('WalletService - refundExchangeBothNoShipmentOnCancel', () => {
  const prismaMock = {} as any;
  const notificationMock = {} as any;

  it('refunds each participant their actual settlement and unwinds peer blocked deposits', async () => {
    const service = new WalletService(prismaMock, notificationMock);

    const settlementsByWallet: Record<
      string,
      { amount: number; meta: object }[]
    > = {
      'buyer-1-wallet-id': [
        {
          amount: 300_000,
          meta: {
            phase: 'exchange_participant_paid',
            payerUserId: 'buyer-1',
            orderId: 'ord-1',
          },
        },
      ],
      'seller-1-wallet-id': [
        {
          amount: 100_000,
          meta: {
            phase: 'exchange_participant_paid',
            payerUserId: 'seller-1',
            orderId: 'ord-1',
          },
        },
      ],
    };

    const pendingDepositsByWallet: Record<
      string,
      { id: string; amount: number; meta: object }[]
    > = {
      'seller-1-wallet-id': [
        {
          id: 'dep-1',
          amount: 200_000,
          meta: { kind: 'order-escrow', phase: 'seller_blocked' },
        },
      ],
    };

    const tx: any = {
      listing: {
        findUnique: jest.fn().mockResolvedValue({ title: 'لپ‌تاپ' }),
      },
      wallet: {
        upsert: jest.fn().mockResolvedValue({}),
        findUnique: jest.fn(async ({ where }: any) => {
          const userId = where.userId as string;
          return { id: `${userId}-wallet-id` };
        }),
        update: jest.fn().mockResolvedValue({}),
      },
      walletTransaction: {
        findMany: jest.fn(async ({ where }: any) => {
          const walletId = where.walletId as string;
          if (where.type === WalletTransactionType.SETTLEMENT) {
            return settlementsByWallet[walletId] ?? [];
          }
          if (where.status === WalletTransactionStatus.PENDING) {
            return pendingDepositsByWallet[walletId] ?? [];
          }
          return [];
        }),
        findFirst: jest.fn().mockResolvedValue(null),
        create: jest.fn().mockResolvedValue({}),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      },
    };

    const summary = await service.refundExchangeBothNoShipmentOnCancel(tx, {
      orderId: 'ord-1',
      listingId: 'lst-1',
      buyerId: 'buyer-1',
      sellerId: 'seller-1',
      verificationFee: 100_000,
      inspectionPenaltyPercent: 20,
    });

    expect(summary).toEqual({
      buyerPaid: 300_000,
      sellerPaid: 100_000,
      buyerRefund: 280_000,
      sellerRefund: 80_000,
      penaltyPerParty: 20_000,
      penaltyPercent: 20,
    });

    expect(tx.wallet.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { userId: 'buyer-1' },
        data: { balanceAvailable: { increment: 280_000 } },
      }),
    );
    expect(tx.wallet.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { userId: 'seller-1' },
        data: { balanceAvailable: { increment: 80_000 } },
      }),
    );
    expect(tx.wallet.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { userId: 'seller-1' },
        data: { balanceBlocked: { decrement: 200_000 } },
      }),
    );

    const refundCreates = tx.walletTransaction.create.mock.calls.map(
      (c: any) => c[0].data,
    );
    expect(refundCreates).toHaveLength(3);
    expect(refundCreates[0].amount).toBe(280_000);
    expect(refundCreates[1].amount).toBe(80_000);
    expect(refundCreates[2].type).toBe(WalletTransactionType.PENALTY);
    expect(refundCreates[2].amount).toBe(200_000);
    expect(refundCreates[2].status).toBe(WalletTransactionStatus.SUCCESS);
    expect(tx.walletTransaction.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: { in: ['dep-1'] } },
        data: { status: WalletTransactionStatus.FAILED },
      }),
    );
  });

  it('with zero penalty percent refunds full paid amount per party (both no-shipment)', async () => {
    const service = new WalletService(prismaMock, notificationMock);

    const settlementsByWallet: Record<
      string,
      { amount: number; meta: object }[]
    > = {
      'buyer-1-wallet-id': [
        {
          amount: 300_000,
          meta: {
            phase: 'exchange_participant_paid',
            payerUserId: 'buyer-1',
            orderId: 'ord-1',
          },
        },
      ],
      'seller-1-wallet-id': [
        {
          amount: 100_000,
          meta: {
            phase: 'exchange_participant_paid',
            payerUserId: 'seller-1',
            orderId: 'ord-1',
          },
        },
      ],
    };

    const tx: any = {
      listing: {
        findUnique: jest.fn().mockResolvedValue({ title: 'لپ‌تاپ' }),
      },
      wallet: {
        upsert: jest.fn().mockResolvedValue({}),
        findUnique: jest.fn(async ({ where }: any) => ({
          id: `${where.userId}-wallet-id`,
        })),
        update: jest.fn().mockResolvedValue({}),
      },
      walletTransaction: {
        findMany: jest.fn(async ({ where }: any) => {
          const walletId = where.walletId as string;
          if (where.type === WalletTransactionType.SETTLEMENT) {
            return settlementsByWallet[walletId] ?? [];
          }
          return [];
        }),
        findFirst: jest.fn().mockResolvedValue(null),
        create: jest.fn().mockResolvedValue({}),
        updateMany: jest.fn().mockResolvedValue({ count: 0 }),
      },
    };

    const summary = await service.refundExchangeBothNoShipmentOnCancel(tx, {
      orderId: 'ord-1',
      listingId: 'lst-1',
      buyerId: 'buyer-1',
      sellerId: 'seller-1',
      verificationFee: 100_000,
      inspectionPenaltyPercent: 0,
    });

    expect(summary).toEqual({
      buyerPaid: 300_000,
      sellerPaid: 100_000,
      buyerRefund: 300_000,
      sellerRefund: 100_000,
      penaltyPerParty: 0,
      penaltyPercent: 0,
    });
  });

  it('does not refund a participant who has no settlement record', async () => {
    const service = new WalletService(prismaMock, notificationMock);

    const tx: any = {
      listing: {
        findUnique: jest.fn().mockResolvedValue({ title: 'لپ‌تاپ' }),
      },
      wallet: {
        upsert: jest.fn().mockResolvedValue({}),
        findUnique: jest.fn(async ({ where }: any) => ({
          id: `${where.userId}-wallet-id`,
        })),
        update: jest.fn().mockResolvedValue({}),
      },
      walletTransaction: {
        findMany: jest.fn().mockResolvedValue([]),
        findFirst: jest.fn().mockResolvedValue(null),
        create: jest.fn().mockResolvedValue({}),
        updateMany: jest.fn().mockResolvedValue({ count: 0 }),
      },
    };

    const summary = await service.refundExchangeBothNoShipmentOnCancel(tx, {
      orderId: 'ord-1',
      listingId: 'lst-1',
      buyerId: 'buyer-1',
      sellerId: 'seller-1',
      verificationFee: 100_000,
      inspectionPenaltyPercent: 20,
    });

    expect(summary.buyerRefund).toBe(0);
    expect(summary.sellerRefund).toBe(0);
    expect(tx.walletTransaction.create).not.toHaveBeenCalled();
    expect(tx.wallet.update).not.toHaveBeenCalled();
  });
});

describe('WalletService - getExchangeParticipantPaidAmount isolation', () => {
  const prismaMock = {} as any;
  const notificationMock = {} as any;

  it('sums only settlements for the target order/listing when buyer paid on two exchanges', async () => {
    const service = new WalletService(prismaMock, notificationMock);

    const settlements = [
      {
        amount: 534_576,
        meta: {
          phase: 'exchange_participant_paid',
          payerUserId: 'buyer-1',
          listingId: 'lst-1',
          orderId: 'ord-1',
        },
        referenceId: 'lst-1',
      },
      {
        amount: 300_000,
        meta: {
          phase: 'exchange_participant_paid',
          payerUserId: 'buyer-1',
          listingId: 'lst-2',
          orderId: 'ord-2',
        },
        referenceId: 'lst-2',
      },
    ];

    const tx: any = {
      wallet: {
        findUnique: jest.fn().mockResolvedValue({ id: 'buyer-1-wallet-id' }),
      },
      walletTransaction: {
        findMany: jest.fn().mockResolvedValue(settlements),
      },
    };

    const paid = await service.resolveExchangeParticipantPaidAmount(tx, {
      participantUserId: 'buyer-1',
      orderId: 'ord-1',
      listingId: 'lst-1',
    });

    expect(paid).toBe(534_576);
  });
});

describe('WalletService - refundExchangePaymentTimeoutOnCancel', () => {
  const prismaMock = {} as any;
  const notificationMock = {} as any;

  it('unwinds peer blocked deposit on seller wallet with SUCCESS PENALTY log', async () => {
    const service = new WalletService(prismaMock, notificationMock);

    const settlementsByWallet: Record<
      string,
      { amount: number; meta: object }[]
    > = {
      'buyer-1-wallet-id': [
        {
          amount: 500_000,
          meta: {
            phase: 'exchange_participant_paid',
            payerUserId: 'buyer-1',
            orderId: 'ord-1',
          },
        },
      ],
    };

    const pendingDepositsByWallet: Record<
      string,
      { id: string; amount: number; meta: object }[]
    > = {
      'seller-1-wallet-id': [
        {
          id: 'dep-seller-blocked',
          amount: 200_000,
          meta: { kind: 'order-escrow', phase: 'seller_blocked' },
        },
      ],
    };

    const tx: any = {
      listing: {
        findUnique: jest.fn().mockResolvedValue({ title: 'گوشی' }),
      },
      wallet: {
        upsert: jest.fn().mockResolvedValue({}),
        findUnique: jest.fn(async ({ where }: any) => ({
          id: `${where.userId}-wallet-id`,
        })),
        update: jest.fn().mockResolvedValue({}),
      },
      walletTransaction: {
        findMany: jest.fn(async ({ where }: any) => {
          const walletId = where.walletId as string;
          if (where.type === WalletTransactionType.SETTLEMENT) {
            return settlementsByWallet[walletId] ?? [];
          }
          if (where.status === WalletTransactionStatus.PENDING) {
            return pendingDepositsByWallet[walletId] ?? [];
          }
          return [];
        }),
        findFirst: jest.fn().mockResolvedValue(null),
        create: jest.fn().mockResolvedValue({}),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      },
    };

    const result = await service.refundExchangePaymentTimeoutOnCancel(tx, {
      orderId: 'ord-1',
      listingId: 'lst-1',
      buyerId: 'buyer-1',
      sellerId: 'seller-1',
      refundBuyer: true,
      refundSeller: false,
      buyerMaxRefund: 500_000,
    });

    expect(result.buyerRefund).toBe(500_000);
    expect(result.sellerRefund).toBe(0);

    expect(tx.wallet.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { userId: 'seller-1' },
        data: { balanceBlocked: { decrement: 200_000 } },
      }),
    );

    const creates = tx.walletTransaction.create.mock.calls.map(
      (c: any) => c[0].data,
    );
    expect(creates).toHaveLength(2);
    expect(creates[0].type).toBe(WalletTransactionType.REFUND);
    expect(creates[0].amount).toBe(500_000);
  });

  it('caps buyer refund to expected share when settlements were over-counted', async () => {
    const service = new WalletService(prismaMock, notificationMock);

    const tx: any = {
      listing: {
        findUnique: jest.fn().mockResolvedValue({ title: 'گوشی' }),
      },
      wallet: {
        upsert: jest.fn().mockResolvedValue({ id: 'buyer-1-wallet-id' }),
        findUnique: jest.fn(async ({ where }: any) => ({
          id: `${where.userId}-wallet-id`,
        })),
        update: jest.fn().mockResolvedValue({}),
      },
      walletTransaction: {
        findMany: jest.fn().mockResolvedValue([
          {
            amount: 834_576,
            meta: {
              phase: 'exchange_participant_paid',
              payerUserId: 'buyer-1',
              listingId: 'lst-1',
            },
            referenceId: 'lst-1',
          },
        ]),
        findFirst: jest.fn().mockResolvedValue(null),
        create: jest.fn().mockResolvedValue({}),
        updateMany: jest.fn().mockResolvedValue({ count: 0 }),
      },
    };

    const result = await service.refundExchangePaymentTimeoutOnCancel(tx, {
      orderId: 'ord-1',
      listingId: 'lst-1',
      buyerId: 'buyer-1',
      sellerId: 'seller-1',
      refundBuyer: true,
      refundSeller: false,
      buyerMaxRefund: 534_576,
    });

    expect(result.buyerRefund).toBe(534_576);

    const refundTx = tx.walletTransaction.create.mock.calls[0][0].data;
    expect(refundTx.type).toBe(WalletTransactionType.REFUND);
    expect(refundTx.amount).toBe(534_576);
  });
});

describe('WalletService - refundExchangeOneSideNoShipmentOnCancel', () => {
  const prismaMock = {} as any;
  const notificationMock = {} as any;

  it('refunds sender fully, offender minus penalty, credits compensation to sender', async () => {
    const service = new WalletService(prismaMock, notificationMock);

    const settlementsByWallet: Record<
      string,
      { amount: number; meta: object }[]
    > = {
      'buyer-1-wallet-id': [
        {
          amount: 300_000,
          meta: {
            phase: 'exchange_participant_paid',
            payerUserId: 'buyer-1',
            orderId: 'ord-1',
          },
        },
      ],
      'seller-1-wallet-id': [
        {
          amount: 100_000,
          meta: {
            phase: 'exchange_participant_paid',
            payerUserId: 'seller-1',
            orderId: 'ord-1',
          },
        },
      ],
    };

    const tx: any = {
      listing: {
        findUnique: jest.fn().mockResolvedValue({ title: 'لپ‌تاپ' }),
      },
      wallet: {
        upsert: jest.fn().mockResolvedValue({}),
        findUnique: jest.fn(async ({ where }: any) => ({
          id: `${where.userId}-wallet-id`,
        })),
        update: jest.fn().mockResolvedValue({}),
      },
      walletTransaction: {
        findMany: jest.fn(async ({ where }: any) => {
          return settlementsByWallet[where.walletId as string] ?? [];
        }),
        findFirst: jest.fn().mockResolvedValue(null),
        create: jest.fn().mockResolvedValue({}),
        updateMany: jest.fn().mockResolvedValue({ count: 0 }),
      },
    };

    const result = await service.refundExchangeOneSideNoShipmentOnCancel(tx, {
      orderId: 'ord-1',
      listingId: 'lst-1',
      buyerId: 'buyer-1',
      sellerId: 'seller-1',
      senderId: 'buyer-1',
      offenderId: 'seller-1',
      verificationFee: 100_000,
      inspectionPenaltyPercent: 20,
    });

    expect(result.senderRefund).toBe(300_000);
    expect(result.offenderRefund).toBe(80_000);
    expect(result.compensation).toBe(20_000);
    expect(tx.walletTransaction.create).toHaveBeenCalledTimes(3);
  });
});
