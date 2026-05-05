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
        findUnique: jest.fn(async ({ where }: any) => ({ id: `${where.userId}-wallet-id` })),
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

    const [sellerTx, buyerTx] = tx.walletTransaction.create.mock.calls.map((c: any) => c[0]);

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
        findUnique: jest.fn(async ({ where }: any) => ({ id: `${where.userId}-wallet-id` })),
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
    const [buyerTx, sellerTx] = tx.walletTransaction.create.mock.calls.map((c: any) => c[0]);

    expect(buyerTx.data.walletId).toBe('buyer-1-wallet-id');
    expect(buyerTx.data.type).toBe(WalletTransactionType.PENALTY);
    expect(buyerTx.data.amount).toBe(123);

    expect(sellerTx.data.walletId).toBe('seller-1-wallet-id');
    expect(sellerTx.data.type).toBe(WalletTransactionType.REFUND);
    expect(sellerTx.data.amount).toBe(123);
  });
});

