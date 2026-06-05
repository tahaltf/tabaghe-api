import 'reflect-metadata';
import { OrderStatus } from '@prisma/client';
import { OperationalNotifyService } from './operational-notify.service';

describe('OperationalNotifyService - exchange inbound hub notifications', () => {
  const makeService = () => {
    const prisma = {
      listing: {
        findUnique: jest.fn().mockResolvedValue({ title: 'گوشی A' }),
      },
    };
    const notificationService = {
      create: jest.fn().mockResolvedValue({ notification: { id: 'n1' }, dispatched: true }),
    };
    const service = new OperationalNotifyService(
      prisma as never,
      notificationService as never,
    );
    return { service, notificationService };
  };

  it('forces site notification and seller role when seller ships to hub', async () => {
    const { service, notificationService } = makeService();

    await service.afterExchangeShipmentUpdated(
      {
        id: 'ord-1',
        buyerId: 'buyer-1',
        sellerId: 'seller-1',
        listingId: 'lst-1',
        status: OrderStatus.SHIPPED_TO_HUB,
        trackingCode: '1'.repeat(24),
        sellerTrackingCode: null,
      },
      'seller-1',
    );

    expect(notificationService.create).toHaveBeenCalledTimes(2);
    expect(notificationService.create).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: 'seller-1',
        forceSiteNotification: true,
        recipientRole: 'SELLER',
        meta: expect.objectContaining({
          phase: 'exchange_self_shipped',
          status: OrderStatus.SHIPPED_TO_HUB,
          role: 'SELLER',
        }),
      }),
    );
    expect(notificationService.create).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: 'buyer-1',
        forceSiteNotification: true,
        recipientRole: 'BUYER',
        meta: expect.objectContaining({
          phase: 'exchange_peer_must_ship',
          role: 'BUYER',
        }),
      }),
    );
  });

  it('notifies buyer when offer item is received at hub', async () => {
    const { service, notificationService } = makeService();

    await service.notifyExchangeHubItemReceived({
      orderId: 'ord-1',
      buyerId: 'buyer-1',
      sellerId: 'seller-1',
      listingId: 'lst-1',
      side: 'OFFER',
      bothReceived: false,
      status: OrderStatus.SHIPPED_TO_HUB,
    });

    expect(notificationService.create).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: 'buyer-1',
        forceSiteNotification: true,
        recipientRole: 'BUYER',
        title: 'دریافت کالای شما در انبار',
        meta: expect.objectContaining({
          phase: 'exchange_hub_offer_received',
          leg: 'OFFER',
        }),
      }),
    );
  });

  it('notifies seller when listing item is received at hub', async () => {
    const { service, notificationService } = makeService();

    await service.notifyExchangeHubItemReceived({
      orderId: 'ord-1',
      buyerId: 'buyer-1',
      sellerId: 'seller-1',
      listingId: 'lst-1',
      side: 'LISTING',
      bothReceived: false,
      status: OrderStatus.SHIPPED_TO_HUB,
    });

    expect(notificationService.create).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: 'seller-1',
        forceSiteNotification: true,
        recipientRole: 'SELLER',
        title: 'دریافت کالای شما در انبار',
      }),
    );
  });

  it('notifies buyer and seller when hub inspection starts', async () => {
    const { service, notificationService } = makeService();

    await service.notifyExchangeHubInspectionStarted({
      orderId: 'ord-1',
      buyerId: 'buyer-1',
      sellerId: 'seller-1',
      listingId: 'lst-1',
      note: 'کارشناسی فنی آغاز شد',
    });

    expect(notificationService.create).toHaveBeenCalledTimes(2);
    expect(notificationService.create).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: 'buyer-1',
        forceSiteNotification: true,
        recipientRole: 'BUYER',
        title: 'شروع کارشناسی در هاب',
        meta: expect.objectContaining({
          phase: 'exchange_hub_inspection_started',
          status: OrderStatus.CHECKING_AT_HUB,
          statusLabel: 'در حال بررسی در هاب',
          role: 'BUYER',
        }),
      }),
    );
    expect(notificationService.create).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: 'seller-1',
        forceSiteNotification: true,
        recipientRole: 'SELLER',
        title: 'شروع کارشناسی در هاب',
        meta: expect.objectContaining({
          phase: 'exchange_hub_inspection_started',
          status: OrderStatus.CHECKING_AT_HUB,
          role: 'SELLER',
        }),
      }),
    );
  });

  it('notifies buyer and seller when inspection verifies both items', async () => {
    const { service, notificationService } = makeService();

    await service.notifyExchangeHubInspectionVerified({
      orderId: 'ord-1',
      buyerId: 'buyer-1',
      sellerId: 'seller-1',
      listingId: 'lst-1',
    });

    expect(notificationService.create).toHaveBeenCalledTimes(2);
    expect(notificationService.create).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: 'seller-1',
        forceSiteNotification: true,
        recipientRole: 'SELLER',
        meta: expect.objectContaining({
          phase: 'exchange_hub_inspection_verified',
          status: OrderStatus.VERIFIED_AT_HUB,
        }),
      }),
    );
  });

  it('notifies buyer and seller when inspection rejects both items', async () => {
    const { service, notificationService } = makeService();

    await service.notifyExchangeHubInspectionRejected({
      orderId: 'ord-1',
      buyerId: 'buyer-1',
      sellerId: 'seller-1',
      listingId: 'lst-1',
    });

    expect(notificationService.create).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: 'seller-1',
        recipientRole: 'SELLER',
        meta: expect.objectContaining({
          phase: 'exchange_hub_inspection_rejected',
          status: OrderStatus.REJECTED_AT_HUB,
        }),
      }),
    );
  });

  it('notifies buyer and seller for financial settlement outcome', async () => {
    const { service, notificationService } = makeService();

    await service.notifyExchangeHubInspectionFinancialSettlement({
      orderId: 'ord-1',
      buyerId: 'buyer-1',
      sellerId: 'seller-1',
      listingId: 'lst-1',
      orderShortId: 'ORD001',
    });

    expect(notificationService.create).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: 'seller-1',
        recipientRole: 'SELLER',
        meta: expect.objectContaining({
          phase: 'exchange_financial_settlement',
        }),
      }),
    );
  });

  it('notifies buyer and seller when order is completed', async () => {
    const { service, notificationService } = makeService();

    await service.notifyOrderCompleted({
      orderId: 'ord-1',
      buyerId: 'buyer-1',
      sellerId: 'seller-1',
      listingId: 'lst-1',
      orderType: 'EXCHANGE',
    });

    expect(notificationService.create).toHaveBeenCalledTimes(2);
    expect(notificationService.create).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: 'seller-1',
        recipientRole: 'SELLER',
        title: 'معامله تکمیل شد',
        meta: expect.objectContaining({
          phaseKey: 'order_completed',
          status: OrderStatus.COMPLETED,
        }),
      }),
    );
  });

  it('tags outbound seller leg with phaseKey for SMS rule lookup', async () => {
    const { service, notificationService } = makeService();

    await service.notifyExchangeHubOutboundShipped({
      orderId: 'ord-1',
      buyerId: 'buyer-1',
      sellerId: 'seller-1',
      listingId: 'lst-1',
      leg: 'TO_SELLER',
      status: OrderStatus.SHIPPED_TO_BUYER,
      trackingCode: 'HB-123',
    });

    expect(notificationService.create).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: 'seller-1',
        recipientRole: 'SELLER',
        meta: expect.objectContaining({
          phaseKey: 'exchange_hub_outbound_TO_SELLER',
          leg: 'TO_SELLER',
        }),
      }),
    );
  });

  it('notifies peer when buyer confirms leg delivery', async () => {
    const { service, notificationService } = makeService();

    await service.notifyExchangeLegDeliveryConfirmed({
      orderId: 'ord-1',
      listingId: 'lst-1',
      buyerId: 'buyer-1',
      sellerId: 'seller-1',
      confirmedBy: 'BUYER',
      status: OrderStatus.SHIPPED_TO_BUYER,
    });

    expect(notificationService.create).toHaveBeenCalledTimes(1);
    expect(notificationService.create).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: 'seller-1',
        recipientRole: 'SELLER',
        meta: expect.objectContaining({
          phaseKey: 'exchange_leg_delivery_confirmed_TO_BUYER',
          leg: 'LISTING',
        }),
      }),
    );
  });

  it('notifies both parties on payment timeout cancel with per-role legs', async () => {
    const { service, notificationService } = makeService();

    await service.notifyExchangePaymentTimeoutCancel({
      orderId: 'ord-1',
      listingId: 'lst-1',
      buyerId: 'buyer-1',
      sellerId: 'seller-1',
      listingTitle: 'گوشی A',
      buyerCompliant: true,
      sellerCompliant: false,
      buyerTicketId: 't-buyer',
      sellerTicketId: 't-seller',
    });

    expect(notificationService.create).toHaveBeenCalledTimes(2);
    expect(notificationService.create).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: 'buyer-1',
        recipientRole: 'BUYER',
        meta: expect.objectContaining({
          phaseKey: 'exchange_payment_timeout_cancel',
          leg: 'OFFER',
        }),
      }),
    );
    expect(notificationService.create).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: 'seller-1',
        recipientRole: 'SELLER',
        meta: expect.objectContaining({
          leg: 'LISTING',
        }),
      }),
    );
  });

  it('notifies both parties when ready to ship after payment', async () => {
    const { service, notificationService } = makeService();

    await service.notifyExchangeReadyToShip({
      id: 'ord-1',
      buyerId: 'buyer-1',
      sellerId: 'seller-1',
      listingId: 'lst-1',
    });

    expect(notificationService.create).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: 'seller-1',
        forceSiteNotification: true,
        recipientRole: 'SELLER',
        meta: expect.objectContaining({
          status: OrderStatus.AWAITING_SHIPMENT_TO_HUB,
          phase: 'exchange_ready_to_ship',
        }),
      }),
    );
  });
});
