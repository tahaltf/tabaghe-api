import { OrderType } from '@prisma/client';
import { OrdersEarlyEscrowService } from './orders-early-escrow.service';
import { SELLER_ESCROW_RELEASE_REASON } from '../../seller-escrow-release.constants';

describe('OrdersEarlyEscrowService', () => {
  const wallet = {
    releaseEscrow: jest.fn(),
  };
  const settings = {
    isReleaseEscrowOnHubVerifiedEnabled: jest.fn(),
  };
  const service = new OrdersEarlyEscrowService(wallet as never, settings as never);

  beforeEach(() => {
    jest.clearAllMocks();
    wallet.releaseEscrow.mockResolvedValue(150_000);
  });

  const baseOrder = {
    id: 'ord-1',
    type: OrderType.DIRECT,
    sellerId: 'seller-1',
    listingId: 'lst-1',
    sellerRevenue: 150_000,
    sellerEscrowReleasedAt: null,
  };

  it('فروشنده بدون فلگ payoutOnShipment بعد از ارسال آزادسازی ندارد', async () => {
    const tx: any = {
      user: { findUnique: jest.fn().mockResolvedValue({ payoutOnShipment: false }) },
      order: { updateMany: jest.fn() },
    };
    const amount = await service.tryTrustedShipmentRelease(tx, baseOrder);
    expect(amount).toBe(0);
    expect(wallet.releaseEscrow).not.toHaveBeenCalled();
  });

  it('فروشنده مورد اعتماد بعد از ارسال سهم را آزاد می‌کند', async () => {
    const tx: any = {
      user: { findUnique: jest.fn().mockResolvedValue({ payoutOnShipment: true }) },
      order: { updateMany: jest.fn().mockResolvedValue({ count: 1 }) },
    };
    const amount = await service.tryTrustedShipmentRelease(tx, baseOrder);
    expect(amount).toBe(150_000);
    expect(wallet.releaseEscrow).toHaveBeenCalledWith(
      'seller-1',
      150_000,
      'lst-1',
      tx,
      {
        orderId: 'ord-1',
        reason: SELLER_ESCROW_RELEASE_REASON.TRUSTED_SHIPMENT,
      },
    );
  });

  it('معاوضه را آزاد نمی‌کند', async () => {
    const tx: any = { user: { findUnique: jest.fn() }, order: { updateMany: jest.fn() } };
    const amount = await service.tryTrustedShipmentRelease(tx, {
      ...baseOrder,
      type: OrderType.EXCHANGE,
    });
    expect(amount).toBe(0);
    expect(wallet.releaseEscrow).not.toHaveBeenCalled();
  });

  it('سوییچ خاموش: تایید کارشناسی آزادسازی ندارد', async () => {
    settings.isReleaseEscrowOnHubVerifiedEnabled.mockResolvedValue(false);
    const tx: any = { order: { updateMany: jest.fn() } };
    const amount = await service.tryHubVerifiedRelease(tx, baseOrder);
    expect(amount).toBe(0);
    expect(wallet.releaseEscrow).not.toHaveBeenCalled();
  });

  it('سوییچ روشن + DIRECT: تایید کارشناسی آزاد می‌کند', async () => {
    settings.isReleaseEscrowOnHubVerifiedEnabled.mockResolvedValue(true);
    const tx: any = { order: { updateMany: jest.fn().mockResolvedValue({ count: 1 }) } };
    const amount = await service.tryHubVerifiedRelease(tx, baseOrder);
    expect(amount).toBe(150_000);
    expect(wallet.releaseEscrow).toHaveBeenCalledWith(
      'seller-1',
      150_000,
      'lst-1',
      tx,
      { orderId: 'ord-1', reason: SELLER_ESCROW_RELEASE_REASON.HUB_VERIFIED },
    );
  });

  it('اگر قبلاً آزاد شده باشد دوباره آزاد نمی‌کند', async () => {
    const tx: any = {
      user: { findUnique: jest.fn().mockResolvedValue({ payoutOnShipment: true }) },
      order: { updateMany: jest.fn() },
    };
    const amount = await service.tryTrustedShipmentRelease(tx, {
      ...baseOrder,
      sellerEscrowReleasedAt: new Date('2026-01-01'),
    });
    expect(amount).toBe(0);
    expect(wallet.releaseEscrow).not.toHaveBeenCalled();
  });

  it('معاوضه در تایید کارشناسی آزاد نمی‌شود', async () => {
    settings.isReleaseEscrowOnHubVerifiedEnabled.mockResolvedValue(true);
    const tx: any = { order: { updateMany: jest.fn() } };
    const amount = await service.tryHubVerifiedRelease(tx, {
      ...baseOrder,
      type: OrderType.EXCHANGE,
    });
    expect(amount).toBe(0);
    expect(wallet.releaseEscrow).not.toHaveBeenCalled();
  });

  it('مزایده حتی با سوییچ روشن در کارشناسی آزاد نمی‌شود', async () => {
    settings.isReleaseEscrowOnHubVerifiedEnabled.mockResolvedValue(true);
    const tx: any = { order: { updateMany: jest.fn() } };
    const amount = await service.tryHubVerifiedRelease(tx, {
      ...baseOrder,
      type: OrderType.AUCTION,
    });
    expect(amount).toBe(0);
    expect(wallet.releaseEscrow).not.toHaveBeenCalled();
  });
});
