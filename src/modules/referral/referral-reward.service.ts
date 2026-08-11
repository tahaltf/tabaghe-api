import { Injectable, Logger } from '@nestjs/common';
import {
  Prisma,
  WalletTransactionStatus,
  WalletTransactionType,
} from '@prisma/client';
import Decimal from 'decimal.js';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { SETTING_KEYS } from '../admin/services/admin-settings.service';
import { resolveReferralCommissionPercent } from '../../common/referral/resolve-referral-commission.util';

type TxClient = Prisma.TransactionClient;

@Injectable()
export class ReferralRewardService {
  private readonly logger = new Logger(ReferralRewardService.name);

  constructor(private readonly prisma: PrismaService) {}

  /**
   * Credits the seller's direct referrer with a % of platformFee.
   * Idempotent per orderId. No multi-level rewards.
   */
  async creditForCompletedOrder(
    orderId: string,
    tx?: TxClient,
  ): Promise<void> {
    const run = async (client: TxClient) => {
      const existing = await client.referralReward.findUnique({
        where: { orderId },
        select: { id: true },
      });
      if (existing) return;

      const order = await client.order.findUnique({
        where: { id: orderId },
        select: {
          id: true,
          sellerId: true,
          platformFee: true,
          status: true,
          seller: {
            select: {
              referredById: true,
            },
          },
        },
      });
      if (!order) return;

      const referrerId = order.seller.referredById;
      if (!referrerId) return;

      const platformFee = new Decimal(order.platformFee?.toString() ?? '0');
      if (platformFee.lte(0)) return;

      const percent = await resolveReferralCommissionPercent(client, referrerId);
      if (percent <= 0) return;

      const amount = platformFee.mul(percent).div(100).floor();
      if (amount.lte(0)) return;

      try {
        await client.referralReward.create({
          data: {
            orderId: order.id,
            referrerId,
            sellerId: order.sellerId,
            platformFee: platformFee.toDecimalPlaces(0),
            percent,
            amount: amount.toDecimalPlaces(0),
          },
        });
      } catch (err) {
        if (
          err instanceof Prisma.PrismaClientKnownRequestError &&
          err.code === 'P2002'
        ) {
          return;
        }
        throw err;
      }

      const wallet = await client.wallet.upsert({
        where: { userId: referrerId },
        create: {
          userId: referrerId,
          balanceAvailable: amount.toNumber(),
          balanceBlocked: 0,
        },
        update: {
          balanceAvailable: { increment: amount.toString() },
        },
      });

      await client.walletTransaction.create({
        data: {
          walletId: wallet.id,
          amount: amount.toNumber(),
          type: WalletTransactionType.REFERRAL_REWARD,
          status: WalletTransactionStatus.SUCCESS,
          referenceId: order.id,
          meta: {
            kind: 'referral-reward',
            orderId: order.id,
            sellerId: order.sellerId,
            platformFee: platformFee.toNumber(),
            percent,
            description: 'پاداش دعوت دوست از کارمزد فروش',
          },
        },
      });
    };

    try {
      if (tx) {
        await run(tx);
      } else {
        await this.prisma.$transaction((client) => run(client));
      }
    } catch (err) {
      this.logger.error(
        `Failed referral reward for order ${orderId}`,
        err instanceof Error ? err.stack : String(err),
      );
    }
  }
}
