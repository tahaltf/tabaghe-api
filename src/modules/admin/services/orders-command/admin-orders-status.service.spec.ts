import 'reflect-metadata';
import { OrderStatus, OrderType } from '@prisma/client';
import { AdminOrdersNotifyService } from './admin-orders-notify.service';
import { AdminOrdersStatusService } from './admin-orders-status.service';

describe('AdminOrdersStatusService - exchange inspection start', () => {
  const makeService = () => {
    const notifyParties = jest.fn().mockResolvedValue(undefined);
    const notify = {
      notifyParties,
      buildDirectHubInspectionRejectionMessaging: jest.fn(),
      notifyHubInspectionRejectedPartiesPush: jest.fn(),
    } as unknown as AdminOrdersNotifyService;
    const operationalNotify = {
      notifyExchangeHubInspectionStarted: jest.fn().mockResolvedValue(undefined),
      notifyOrderCompleted: jest.fn().mockResolvedValue(undefined),
    };
    const prisma = {
      order: {
        findUnique: jest.fn().mockResolvedValue({
          id: 'ord-1',
          buyerId: 'buyer-1',
          sellerId: 'seller-1',
          status: OrderStatus.RECEIVED_AT_HUB,
          type: OrderType.EXCHANGE,
          listingId: 'lst-1',
          totalAmount: 0,
          sellerRevenue: 0,
          returnTrackingCode: null,
          trackingCode: null,
          sellerTrackingCode: null,
          packagingVideo: null,
          buyerPackagingVideo: null,
          tradeReputationAt: null,
          listing: { id: 'lst-1', title: 'گوشی A', thumbnail: null },
        }),
        update: jest.fn().mockResolvedValue({
          id: 'ord-1',
          status: OrderStatus.CHECKING_AT_HUB,
        }),
      },
      $transaction: jest.fn((fn) =>
        fn({
          order: {
            update: jest.fn().mockResolvedValue({
              id: 'ord-1',
              status: OrderStatus.CHECKING_AT_HUB,
            }),
          },
        }),
      ),
    };
    const service = new AdminOrdersStatusService(
      prisma as never,
      { getApiUrl: jest.fn().mockReturnValue('https://api.example.com') } as never,
      {} as never,
      {} as never,
      { ensureBuyerConfirmDeadline: jest.fn().mockResolvedValue(undefined) } as never,
      {} as never,
      { assertTransition: jest.fn() } as never,
      notify,
      operationalNotify as never,
      {} as never,
      {
        isOrderUnpaid: jest.fn().mockResolvedValue(false),
        cancelUnpaidOrder: jest.fn(),
      } as never,
    );
    return { service, notifyParties, operationalNotify, prisma };
  };

  it('uses exchange hub inspection notify for both parties on CHECKING_AT_HUB', async () => {
    const { service, notifyParties, operationalNotify } = makeService();

    await service.updateStatus('ord-1', OrderStatus.CHECKING_AT_HUB, 'شروع شد');

    expect(operationalNotify.notifyExchangeHubInspectionStarted).toHaveBeenCalledWith({
      orderId: 'ord-1',
      buyerId: 'buyer-1',
      sellerId: 'seller-1',
      listingId: 'lst-1',
      note: 'شروع شد',
    });
    expect(notifyParties).not.toHaveBeenCalled();
  });
});
