import { Injectable } from '@nestjs/common';
import { OrderStatus, Prisma } from '@prisma/client';

/** موفقیت معامله: به هر طرف */
export const TRADE_REPUTATION_SUCCESS_DELTA = 0.7;
/** مرجوعی / شکست معامله جدی */
export const TRADE_REPUTATION_PENALTY_DELTA = 1.5;
export const TRADE_REPUTATION_CAP = 5;

export type OrderReputationSnapshot = {
  id: string;
  buyerId: string;
  sellerId: string;
  tradeReputationAt: Date | null;
};

@Injectable()
export class OrderReputationService {
  /**
   * بعد از اینکه وضعیت سفارش در DB به COMPLETED یا CANCELLED تغییر کرد، فراخوانی شود.
   * `order` اسنپ‌شات قبل از آن تراکنش (tradeReputationAt هنوز null است مگر اینکه قبلاً ثبت شده باشد).
   */
  async recordTerminalOutcome(
    tx: Prisma.TransactionClient,
    order: OrderReputationSnapshot,
    previousStatus: OrderStatus,
    outcome: 'SUCCESS' | 'FAILURE',
    opts?: { failurePenalizeUserIds?: string[]; ignoreEarlyAbort?: boolean },
  ): Promise<void> {
    if (order.tradeReputationAt) return;

    if (outcome === 'SUCCESS') {
      await this.bumpUsers(
        tx,
        [order.buyerId, order.sellerId],
        TRADE_REPUTATION_SUCCESS_DELTA,
        'cap',
      );
    } else {
      if (
        !opts?.ignoreEarlyAbort &&
        this.isEarlyAbortWithoutTrade(previousStatus)
      )
        return;
      const targets =
        opts?.failurePenalizeUserIds !== undefined
          ? opts.failurePenalizeUserIds
          : [order.buyerId, order.sellerId];
      if (targets.length > 0) {
        await this.bumpUsers(
          tx,
          targets,
          -TRADE_REPUTATION_PENALTY_DELTA,
          'floor',
        );
      }
    }

    await tx.order.update({
      where: { id: order.id },
      data: { tradeReputationAt: new Date() },
    });
  }

  private isEarlyAbortWithoutTrade(status: OrderStatus): boolean {
    return (
      status === OrderStatus.PENDING || status === OrderStatus.AWAITING_PAYMENT
    );
  }

  private async bumpUsers(
    tx: Prisma.TransactionClient,
    userIds: string[],
    delta: number,
    mode: 'cap' | 'floor',
  ): Promise<void> {
    const unique = [...new Set(userIds)];
    for (const userId of unique) {
      const u = await tx.user.findUnique({
        where: { id: userId },
        select: { rating: true },
      });
      if (!u) continue;
      const current = Number(u.rating ?? TRADE_REPUTATION_CAP);
      let next = current + delta;
      if (mode === 'cap') {
        next = Math.min(TRADE_REPUTATION_CAP, next);
      } else {
        next = Math.max(0, next);
      }
      await tx.user.update({
        where: { id: userId },
        data: { rating: next },
      });
    }
  }
}
