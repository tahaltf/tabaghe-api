import {
  isHubOutboundShipmentNotificationMeta,
  isInspectionLikeHubNote,
} from './hub-shipment-note.util';

describe('hub-shipment-note.util', () => {
  it('rejects inspection settlement notes', () => {
    expect(
      isInspectionLikeHubNote(
        'کارشناسی معاوضه با اصلاح مالی تایید شد. کالای آگهی: تایید',
      ),
    ).toBe(true);
  });

  it('accepts hub outbound shipment meta', () => {
    expect(
      isHubOutboundShipmentNotificationMeta({
        status: 'SHIPPED_TO_BUYER',
        note: 'مرسوله خروجی مربوط به شما از هاب ارسال شد و کد رهگیری ثبت گردید.',
        audience: 'BUYER',
      }),
    ).toBe(true);
  });

  it('accepts exchange hub outbound phase with tracking code', () => {
    expect(
      isHubOutboundShipmentNotificationMeta({
        status: 'SHIPPED_TO_BUYER',
        phase: 'exchange_hub_outbound_shipped',
        trackingCode: 'HS-123',
        leg: 'TO_SELLER',
        audience: 'SELLER',
      }),
    ).toBe(true);
  });

  it('rejects verified-at-hub inspection meta', () => {
    expect(
      isHubOutboundShipmentNotificationMeta({
        status: 'VERIFIED_AT_HUB',
        note: 'کارشناسی معاوضه با اصلاح مالی تایید شد.',
        audience: 'SELLER',
      }),
    ).toBe(false);
  });
});
