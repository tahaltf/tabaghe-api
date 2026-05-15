import { NotificationType, OrderStatus, OrderType } from '@prisma/client';
import { UsersService } from './users.service';

describe('UsersService panel badges', () => {
  const prismaMock = {
    notification: {
      findMany: jest.fn(),
      updateMany: jest.fn(),
    },
    order: {
      findMany: jest.fn(),
    },
  };

  const service = new UsersService(prismaMock as never);

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('maps ORDER_STATUS_CHANGED with audience to buy/sell and dedupes by orderId', async () => {
    prismaMock.notification.findMany.mockResolvedValue([
      {
        id: 'n1',
        type: NotificationType.ORDER_STATUS_CHANGED,
        meta: { orderId: 'ord-1', audience: 'BUYER' },
        createdAt: new Date(),
      },
      {
        id: 'n2',
        type: NotificationType.ORDER_STATUS_CHANGED,
        meta: { orderId: 'ord-1', audience: 'BUYER' },
        createdAt: new Date(),
      },
      {
        id: 'n3',
        type: NotificationType.ORDER_STATUS_CHANGED,
        meta: { orderId: 'ord-2', audience: 'SELLER' },
        createdAt: new Date(),
      },
    ]);
    prismaMock.order.findMany.mockResolvedValue([
      {
        id: 'ord-1',
        buyerId: 'user-1',
        sellerId: 'other',
        status: OrderStatus.SHIPPED,
        type: OrderType.DIRECT,
      },
      {
        id: 'ord-2',
        buyerId: 'other',
        sellerId: 'user-1',
        status: OrderStatus.PAID,
        type: OrderType.DIRECT,
      },
    ]);

    const badges = await service.getPanelBadges('user-1');

    expect(badges.buy).toBe(1);
    expect(badges.sell).toBe(1);
    expect(badges.requests).toBe(0);
  });

  it('ignores completed/cancelled orders for buy/sell badges', async () => {
    prismaMock.notification.findMany.mockResolvedValue([
      {
        id: 'n1',
        type: NotificationType.ORDER_STATUS_CHANGED,
        meta: { orderId: 'ord-done' },
        createdAt: new Date(),
      },
    ]);
    prismaMock.order.findMany.mockResolvedValue([
      {
        id: 'ord-done',
        buyerId: 'user-1',
        sellerId: 'other',
        status: OrderStatus.COMPLETED,
        type: OrderType.DIRECT,
      },
    ]);

    const badges = await service.getPanelBadges('user-1');
    expect(badges.buy).toBe(0);
  });

  it('keeps exchange offers in requests only', async () => {
    prismaMock.notification.findMany.mockResolvedValue([
      {
        id: 'n1',
        type: NotificationType.EXCHANGE_OFFER_RECEIVED,
        meta: { exchangeOfferId: 'off-1' },
        createdAt: new Date(),
      },
    ]);
    prismaMock.order.findMany.mockResolvedValue([]);

    const badges = await service.getPanelBadges('user-1');
    expect(badges.requests).toBe(1);
    expect(badges.buy).toBe(0);
    expect(badges.sell).toBe(0);
  });
});
