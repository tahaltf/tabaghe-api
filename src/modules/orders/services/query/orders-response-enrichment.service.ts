import { Injectable } from '@nestjs/common';
import { OrderStatus, OrderType } from '@prisma/client';
import { PrismaService } from '../../../../infrastructure/prisma/prisma.service';
import { OrdersSettingsService } from '../../orders-settings.service';

export const BUYER_CONFIRM_ELIGIBLE_STATUSES: OrderStatus[] = [
  OrderStatus.SHIPPED,
  OrderStatus.SHIPPED_TO_BUYER,
  OrderStatus.DELIVERED,
];

const SHIPPING_DEADLINE_ELIGIBLE_STATUSES: OrderStatus[] = [
  OrderStatus.PAID,
  OrderStatus.AWAITING_SHIPMENT_TO_HUB,
  OrderStatus.SHIPPED_TO_HUB,
];

const DEFAULT_BUYER_CONFIRM_DEADLINE_MINUTES = 4 * 24 * 60;

@Injectable()
export class OrdersResponseEnrichmentService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly settings: OrdersSettingsService,
  ) {}

  /** برای ثبت مهلت هنگام ارسال از هاب / ارسال مستقیم */
  computeBuyerConfirmDeadlineNow(): Promise<Date> {
    return this.buildBuyerConfirmDeadlineFrom(new Date());
  }

  /** ثبت مهلت تایید دریافت هنگام ورود به وضعیت «ارسال‌شده» (یک‌بار) */
  async ensureBuyerConfirmDeadline(orderId: string): Promise<void> {
    const order = await this.prisma.order.findUnique({
      where: { id: orderId },
      select: {
        id: true,
        status: true,
        buyerConfirmDeadline: true,
        updatedAt: true,
        createdAt: true,
      },
    });
    if (!order) return;
    if (order.buyerConfirmDeadline) return;
    if (!BUYER_CONFIRM_ELIGIBLE_STATUSES.includes(order.status)) {
      return;
    }
    const minutes = await this.getBuyerConfirmDeadlineMinutes();
    const base = order.updatedAt ?? order.createdAt ?? new Date();
    const ageMs = Date.now() - base.getTime();
    const deadlineBase = ageMs > minutes * 60 * 1000 ? new Date() : base;
    const deadline = await this.buildBuyerConfirmDeadlineFrom(deadlineBase);
    await this.prisma.order.update({
      where: { id: orderId },
      data: { buyerConfirmDeadline: deadline },
    });
  }

  /** پس از ensure در DB، مقدار را روی آبجکت سفارش برای پاسخ API می‌نشاند */
  async attachBuyerConfirmDeadline<
    T extends {
      id: string;
      status: OrderStatus;
      type?: OrderType;
      buyerConfirmDeadline?: Date | null;
      shippingDeadline?: Date | null;
      updatedAt: Date;
      createdAt: Date;
      disputedAt?: Date | null;
    },
  >(order: T): Promise<T> {
    let next = await this.attachShippingDeadline(order);

    if (!BUYER_CONFIRM_ELIGIBLE_STATUSES.includes(next.status)) {
      return this.enrichOrderClientFields(next);
    }
    await this.ensureBuyerConfirmDeadline(next.id);
    const fresh = await this.prisma.order.findUnique({
      where: { id: next.id },
      select: { buyerConfirmDeadline: true },
    });
    const deadline =
      fresh?.buyerConfirmDeadline ??
      (await this.resolveEffectiveBuyerConfirmDeadline({
        status: next.status,
        buyerConfirmDeadline: fresh?.buyerConfirmDeadline ?? null,
        updatedAt: next.updatedAt,
        createdAt: next.createdAt,
      }));
    if (!deadline) return this.enrichOrderClientFields(next);
    return this.enrichOrderClientFields({
      ...next,
      buyerConfirmDeadline: deadline,
    });
  }

  /**
   * سفارش‌های پرداخت‌شده بدون shippingDeadline (باگ سبد/تسویه ناقص)
   * را هنگام خواندن جزئیات بک‌فیل می‌کند تا فروشنده مهلت را ببیند.
   */
  async ensureShippingDeadline(orderId: string): Promise<void> {
    const order = await this.prisma.order.findUnique({
      where: { id: orderId },
      select: {
        id: true,
        status: true,
        type: true,
        shippingDeadline: true,
        updatedAt: true,
        createdAt: true,
      },
    });
    if (!order) return;
    if (order.shippingDeadline) return;
    if (!SHIPPING_DEADLINE_ELIGIBLE_STATUSES.includes(order.status)) return;

    const deadline = await this.settings.resolveEffectiveShippingDeadline({
      type: order.type,
      shippingDeadline: null,
      updatedAt: order.updatedAt,
      createdAt: order.createdAt,
    });
    if (!deadline) return;

    await this.prisma.order.update({
      where: { id: order.id },
      data: { shippingDeadline: deadline },
    });
  }

  private async attachShippingDeadline<
    T extends {
      id: string;
      status: OrderStatus;
      type?: OrderType;
      shippingDeadline?: Date | null;
      updatedAt: Date;
      createdAt: Date;
    },
  >(order: T): Promise<T> {
    if (!SHIPPING_DEADLINE_ELIGIBLE_STATUSES.includes(order.status)) {
      return order;
    }
    if (order.shippingDeadline) return order;

    await this.ensureShippingDeadline(order.id);
    const fresh = await this.prisma.order.findUnique({
      where: { id: order.id },
      select: { shippingDeadline: true },
    });
    const deadline =
      fresh?.shippingDeadline ??
      (await this.settings.resolveEffectiveShippingDeadline({
        type: order.type,
        shippingDeadline: null,
        updatedAt: order.updatedAt,
        createdAt: order.createdAt,
      }));
    if (!deadline) return order;
    return { ...order, shippingDeadline: deadline };
  }

  enrichOrderClientFields<T extends Record<string, unknown>>(order: T): T {
    const o = order as T & {
      cancelReason?: string | null;
      status?: OrderStatus;
      sellerShippingAddress?: string | null;
      sellerShippingPostalCode?: string | null;
      buyerConfirmDeadline?: Date | string | null;
    };
    const parsed = this.parseReturnDestinationFromCancelReason(
      o.cancelReason ?? null,
    );
    let returnDestinationAddress = parsed.address;
    let returnDestinationPostalCode = parsed.postalCode;
    if (
      (!returnDestinationAddress || returnDestinationAddress.length < 5) &&
      o.status &&
      (o.status === OrderStatus.RETURN_REQUESTED ||
        o.status === OrderStatus.RETURN_SHIPPED)
    ) {
      returnDestinationAddress =
        o.sellerShippingAddress?.trim() || returnDestinationAddress;
      returnDestinationPostalCode =
        o.sellerShippingPostalCode?.trim() || returnDestinationPostalCode;
    }
    const deadlineRaw = o.buyerConfirmDeadline;
    const buyerConfirmDeadline =
      deadlineRaw instanceof Date
        ? deadlineRaw.toISOString()
        : typeof deadlineRaw === 'string'
          ? deadlineRaw
          : null;
    const exchangePaymentDeadlineRaw = (o as { exchangePaymentDeadline?: unknown })
      .exchangePaymentDeadline;
    const exchangePaymentDeadline =
      exchangePaymentDeadlineRaw instanceof Date
        ? exchangePaymentDeadlineRaw.toISOString()
        : typeof exchangePaymentDeadlineRaw === 'string'
          ? exchangePaymentDeadlineRaw
          : null;
    const shippingDeadlineRaw = (o as { shippingDeadline?: unknown })
      .shippingDeadline;
    const shippingDeadline =
      shippingDeadlineRaw instanceof Date
        ? shippingDeadlineRaw.toISOString()
        : typeof shippingDeadlineRaw === 'string'
          ? shippingDeadlineRaw
          : null;
    return {
      ...order,
      buyerConfirmDeadline,
      exchangePaymentDeadline,
      shippingDeadline,
      returnDestinationAddress: returnDestinationAddress ?? null,
      returnDestinationPostalCode: returnDestinationPostalCode ?? null,
    } as T;
  }

  private parseReturnDestinationFromCancelReason(cancelReason: string | null): {
    address: string | null;
    postalCode: string | null;
  } {
    const raw = String(cancelReason || '');
    if (!raw.trim()) {
      return { address: null, postalCode: null };
    }
    const lines = raw.split('\n').map((x) => x.trim());
    const pick = (labels: string[]) => {
      for (const label of labels) {
        const line = lines.find((x) => x.startsWith(`${label}:`));
        if (!line) continue;
        const val = line.slice(label.length + 1).trim();
        if (val) return val;
      }
      return null;
    };
    return {
      address: pick(['آدرس مقصد', 'نشانی مقصد', 'آدرس مرجوعی']),
      postalCode: pick(['کدپستی مقصد', 'کد پستی مقصد', 'کدپستی مرجوعی']),
    };
  }

  async isBuyerConfirmDeadlineExpired(order: {
    status: OrderStatus;
    buyerConfirmDeadline: Date | null;
    disputedAt: Date | null;
    updatedAt: Date;
    createdAt: Date;
  }): Promise<boolean> {
    if (order.disputedAt) return false;
    if (!BUYER_CONFIRM_ELIGIBLE_STATUSES.includes(order.status)) {
      return false;
    }
    const deadline = await this.resolveEffectiveBuyerConfirmDeadline(order);
    if (!deadline) return false;
    return deadline.getTime() <= Date.now();
  }

  private async resolveEffectiveBuyerConfirmDeadline(order: {
    status: OrderStatus;
    buyerConfirmDeadline: Date | null;
    updatedAt: Date;
    createdAt: Date;
  }): Promise<Date | null> {
    if (!BUYER_CONFIRM_ELIGIBLE_STATUSES.includes(order.status)) {
      return null;
    }
    if (order.buyerConfirmDeadline) return order.buyerConfirmDeadline;
    const minutes = await this.getBuyerConfirmDeadlineMinutes();
    const base = order.updatedAt ?? order.createdAt;
    if (!base) return null;
    return new Date(base.getTime() + minutes * 60 * 1000);
  }

  private async buildBuyerConfirmDeadlineFrom(from: Date): Promise<Date> {
    const minutes = await this.getBuyerConfirmDeadlineMinutes();
    return new Date(from.getTime() + minutes * 60 * 1000);
  }

  private async getBuyerConfirmDeadlineMinutes(): Promise<number> {
    const setting = await this.prisma.systemSetting.findFirst({
      where: {
        key: {
          in: ['BUYER_CONFIRM_DEADLINE_MINUTES', 'BUYER_CONFIRM_DEADLINE_DAYS'],
        },
      },
      orderBy: { key: 'asc' },
    });
    let minutes = this.parsePositiveIntSetting(
      setting?.value,
      DEFAULT_BUYER_CONFIRM_DEADLINE_MINUTES,
    );
    if (setting?.key === 'BUYER_CONFIRM_DEADLINE_DAYS') {
      minutes *= 24 * 60;
    }
    return minutes;
  }

  private parsePositiveIntSetting(
    value: string | null | undefined,
    fallback: number,
  ): number {
    const parsed = Number(value ?? '');
    if (!Number.isFinite(parsed) || parsed <= 0) return fallback;
    return Math.floor(parsed);
  }
}
