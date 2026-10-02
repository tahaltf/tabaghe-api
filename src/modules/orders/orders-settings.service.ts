import { Injectable } from '@nestjs/common';
import { OrderStatus, OrderType, Prisma } from '@prisma/client';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { readPositiveIntSetting } from '../../common/system-settings/numeric-setting.util';
import {
  DEFAULT_BUYER_CONFIRM_DEADLINE_MINUTES,
  DEFAULT_EXCHANGE_NO_PAYMENT_TIMEOUT_HOURS,
  DEFAULT_EXCHANGE_NO_SHIPMENT_COMPENSATION,
  DEFAULT_EXCHANGE_PAYMENT_DEADLINE_MINUTES,
  DEFAULT_EXCHANGE_RETURN_CONFIRM_DEADLINE_MINUTES,
  DEFAULT_EXCHANGE_SECOND_PAYMENT_TIMEOUT_HOURS,
  DEFAULT_EXCHANGE_SHIPMENT_TIMEOUT_HOURS,
  DEFAULT_ORDER_VIDEO_RETENTION_DAYS,
  DEFAULT_SELLER_RETURN_CONFIRM_DEADLINE_MINUTES,
  DEFAULT_SELLER_SHIP_DEADLINE_MINUTES,
  EXCHANGE_PAYMENT_TIMEOUT_TRUST_PENALTY,
} from './orders.constants';

@Injectable()
export class OrdersSettingsService {
  constructor(private readonly prisma: PrismaService) {}

  async getSellerReturnConfirmDeadlineMinutes(): Promise<number> {
    const rows = await this.prisma.systemSetting.findMany({
      where: {
        key: {
          in: [
            'SELLER_RETURN_CONFIRM_DEADLINE_MINUTES',
            'SELLER_RETURN_CONFIRM_DEADLINE_HOURS',
          ],
        },
      },
    });
    const byKey = new Map(rows.map((r) => [r.key, r]));
    const fallback =
      DEFAULT_SELLER_RETURN_CONFIRM_DEADLINE_MINUTES;
    const minutesRow =
      byKey.get('SELLER_RETURN_CONFIRM_DEADLINE_MINUTES')?.value?.trim();
    if (minutesRow) {
      const minutes = Number(minutesRow.replace(/[^\d.]/g, ''));
      if (Number.isFinite(minutes) && minutes > 0) {
        return Math.floor(minutes);
      }
    }
    const hoursRow =
      byKey.get('SELLER_RETURN_CONFIRM_DEADLINE_HOURS')?.value?.trim();
    if (hoursRow) {
      const hours = Number(hoursRow.replace(/[^\d.]/g, ''));
      if (Number.isFinite(hours) && hours > 0) {
        return Math.floor(hours * 60);
      }
    }
    return fallback;
  }

  async getSellerShipDeadlineMinutes(): Promise<number> {
    const setting = await this.prisma.systemSetting.findFirst({
      where: {
        key: {
          in: ['SELLER_SHIP_DEADLINE_MINUTES', 'SELLER_SHIP_DEADLINE_DAYS'],
        },
      },
      orderBy: { key: 'asc' },
    });
    let minutes = this.parsePositiveIntSetting(
      setting?.value,
      DEFAULT_SELLER_SHIP_DEADLINE_MINUTES,
    );
    if (setting?.key === 'SELLER_SHIP_DEADLINE_DAYS') {
      minutes *= 24 * 60;
    }
    return minutes;
  }

  async resolveEffectiveShippingDeadline(order: {
    type?: OrderType;
    shippingDeadline: Date | null;
    updatedAt: Date;
    createdAt: Date;
  }): Promise<Date | null> {
    if (order.shippingDeadline) return order.shippingDeadline;
    const minutes =
      order.type === OrderType.EXCHANGE
        ? await this.getExchangeShipmentDeadlineMinutes()
        : await this.getSellerShipDeadlineMinutes();
    const base = order.updatedAt ?? order.createdAt;
    if (!base) return null;
    return new Date(base.getTime() + minutes * 60 * 1000);
  }

  parsePositiveIntSetting(
    value: string | null | undefined,
    fallback: number,
  ): number {
    const parsed = Number(value ?? '');
    if (!Number.isFinite(parsed) || parsed <= 0) return fallback;
    return Math.floor(parsed);
  }

  async getBuyerConfirmDeadlineMinutes(): Promise<number> {
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

  async getExchangeNoShipmentCompensation(): Promise<number> {
    const findUnique = (this.prisma.systemSetting as any)?.findUnique;
    if (typeof findUnique !== 'function') {
      return DEFAULT_EXCHANGE_NO_SHIPMENT_COMPENSATION;
    }
    const setting = await findUnique.call(this.prisma.systemSetting, {
      where: { key: 'EXCHANGE_NO_SHIPMENT_COMPENSATION' },
      select: { value: true },
    });
    const parsed = this.parsePositiveIntSetting(
      setting?.value,
      DEFAULT_EXCHANGE_NO_SHIPMENT_COMPENSATION,
    );
    return Math.max(0, parsed);
  }

  async getExchangePaymentTrustPenalty(
    tx: Prisma.TransactionClient | PrismaService = this.prisma,
  ): Promise<number> {
    return readPositiveIntSetting(
      tx,
      'EXCHANGE_PAYMENT_TRUST_PENALTY',
      EXCHANGE_PAYMENT_TIMEOUT_TRUST_PENALTY,
    );
  }

  async getExchangePaymentDeadlineMinutes(): Promise<number> {
    const minutesSetting = await this.prisma.systemSetting.findUnique({
      where: { key: 'EXCHANGE_PAYMENT_DEADLINE_MINUTES' },
      select: { value: true },
    });
    if (minutesSetting?.value?.trim()) {
      return this.parsePositiveIntSetting(
        minutesSetting.value,
        DEFAULT_EXCHANGE_PAYMENT_DEADLINE_MINUTES,
      );
    }
    const hours = await this.getExchangeNoPaymentTimeoutHours();
    return hours * 60;
  }

  async getExchangeNoPaymentTimeoutHours(): Promise<number> {
    const setting = await this.prisma.systemSetting.findUnique({
      where: { key: 'EXCHANGE_NO_PAYMENT_TIMEOUT_HOURS' },
      select: { value: true },
    });
    return this.parsePositiveIntSetting(
      setting?.value,
      DEFAULT_EXCHANGE_NO_PAYMENT_TIMEOUT_HOURS,
    );
  }

  async getExchangeSecondPaymentTimeoutHours(): Promise<number> {
    const setting = await this.prisma.systemSetting.findUnique({
      where: { key: 'EXCHANGE_SECOND_PAYMENT_TIMEOUT_HOURS' },
      select: { value: true },
    });
    return this.parsePositiveIntSetting(
      setting?.value,
      DEFAULT_EXCHANGE_SECOND_PAYMENT_TIMEOUT_HOURS,
    );
  }

  async getExchangeShipmentDeadlineMinutes(): Promise<number> {
    const minutesSetting = await this.prisma.systemSetting.findUnique({
      where: { key: 'EXCHANGE_SHIP_DEADLINE_MINUTES' },
      select: { value: true },
    });
    if (minutesSetting?.value?.trim()) {
      return this.parsePositiveIntSetting(
        minutesSetting.value,
        DEFAULT_SELLER_SHIP_DEADLINE_MINUTES,
      );
    }
    const hours = await this.getExchangeShipmentTimeoutHours();
    return hours * 60;
  }

  async getExchangeShipmentTimeoutHours(): Promise<number> {
    const setting = await this.prisma.systemSetting.findUnique({
      where: { key: 'EXCHANGE_SHIPMENT_TIMEOUT_HOURS' },
      select: { value: true },
    });
    return this.parsePositiveIntSetting(
      setting?.value,
      DEFAULT_EXCHANGE_SHIPMENT_TIMEOUT_HOURS,
    );
  }

  async getExchangeReturnConfirmDeadlineMinutes(): Promise<number> {
    const setting = await this.prisma.systemSetting.findFirst({
      where: {
        key: {
          in: [
            'EXCHANGE_RETURN_CONFIRM_DEADLINE_MINUTES',
            'EXCHANGE_RETURN_CONFIRM_DEADLINE_HOURS',
          ],
        },
      },
      orderBy: { key: 'asc' },
    });
    const fallback =
      DEFAULT_EXCHANGE_RETURN_CONFIRM_DEADLINE_MINUTES;
    const parsed = this.parsePositiveIntSetting(setting?.value, fallback);
    if (setting?.key === 'EXCHANGE_RETURN_CONFIRM_DEADLINE_HOURS') {
      return parsed * 60;
    }
    return parsed;
  }


  async isReleaseEscrowOnHubVerifiedEnabled(): Promise<boolean> {
    const setting = await this.prisma.systemSetting.findUnique({
      where: { key: 'RELEASE_ESCROW_ON_HUB_VERIFIED' },
      select: { value: true },
    });
    const v = setting?.value?.trim().toLowerCase();
    return v === 'true' || v === '1' || v === 'yes';
  }

  async getOrderVideoRetentionDays(): Promise<number> {
    const setting = await this.prisma.systemSetting.findUnique({
      where: { key: 'ORDER_COMPLETED_VIDEO_RETENTION_DAYS' },
      select: { value: true },
    });
    return this.parsePositiveIntSetting(
      setting?.value,
      DEFAULT_ORDER_VIDEO_RETENTION_DAYS,
    );
  }
}
