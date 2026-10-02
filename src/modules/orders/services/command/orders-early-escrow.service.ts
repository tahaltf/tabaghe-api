import { Injectable } from '@nestjs/common';
import { OrderType, Prisma } from '@prisma/client';
import { WalletService } from '../../../wallet/wallet.service';
import { OrdersSettingsService } from '../../orders-settings.service';
import {
  SELLER_ESCROW_RELEASE_REASON,
  type SellerEscrowReleaseReason,
} from '../../seller-escrow-release.constants';

export type EarlyEscrowOrder = {
  id: string;
  type: OrderType | string;
  sellerId: string;
  listingId: string;
  sellerRevenue: unknown;
  sellerEscrowReleasedAt?: Date | null;
};

@Injectable()
export class OrdersEarlyEscrowService {
  constructor(
    private readonly walletService: WalletService,
    private readonly settings: OrdersSettingsService,
  ) {}

  async markReleasedIfNeeded(
    tx: Prisma.TransactionClient,
    orderId: string,
    reason: SellerEscrowReleaseReason,
  ): Promise<void> {
    await tx.order.updateMany({
      where: { id: orderId, sellerEscrowReleasedAt: null },
      data: {
        sellerEscrowReleasedAt: new Date(),
        sellerEscrowReleaseReason: reason,
      },
    });
  }

  async releaseIfNeeded(
    tx: Prisma.TransactionClient,
    order: EarlyEscrowOrder,
    reason: SellerEscrowReleaseReason,
    opts?: {
      requirePayoutOnShipment?: boolean;
      requireHubSetting?: boolean;
    },
  ): Promise<number> {
    if (order.type === OrderType.EXCHANGE || order.type === 'EXCHANGE') {
      return 0;
    }
    if (order.sellerEscrowReleasedAt) return 0;

    if (opts?.requirePayoutOnShipment) {
      const seller = await tx.user.findUnique({
        where: { id: order.sellerId },
        select: { payoutOnShipment: true },
      });
      if (!seller?.payoutOnShipment) return 0;
    }

    if (opts?.requireHubSetting) {
      if (order.type !== OrderType.DIRECT && order.type !== 'DIRECT') {
        return 0;
      }
      if (!(await this.settings.isReleaseEscrowOnHubVerifiedEnabled())) {
        return 0;
      }
    }

    const released = await this.walletService.releaseEscrow(
      order.sellerId,
      Number(order.sellerRevenue || 0),
      order.listingId,
      tx,
      { orderId: order.id, reason },
    );
    await this.markReleasedIfNeeded(tx, order.id, reason);
    return Number(released || 0);
  }

  async tryTrustedShipmentRelease(
    tx: Prisma.TransactionClient,
    order: EarlyEscrowOrder,
  ): Promise<number> {
    return this.releaseIfNeeded(
      tx,
      order,
      SELLER_ESCROW_RELEASE_REASON.TRUSTED_SHIPMENT,
      { requirePayoutOnShipment: true },
    );
  }

  async tryHubVerifiedRelease(
    tx: Prisma.TransactionClient,
    order: EarlyEscrowOrder,
  ): Promise<number> {
    return this.releaseIfNeeded(
      tx,
      order,
      SELLER_ESCROW_RELEASE_REASON.HUB_VERIFIED,
      { requireHubSetting: true },
    );
  }
}
