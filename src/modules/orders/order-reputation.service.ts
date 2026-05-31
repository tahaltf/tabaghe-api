import { Injectable } from '@nestjs/common';
import { OrderStatus, Prisma } from '@prisma/client';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { UserRatingHistoryService } from '../users/user-rating-history.service';

/** موفقیت معامله: به هر طرف */
export const TRADE_REPUTATION_SUCCESS_DELTA = 0.5;
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
  constructor(
    private readonly prisma: PrismaService,
    private readonly userRatingHistory: UserRatingHistoryService,
  ) {}

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

    const successDelta = await this.getSuccessDelta(tx);
    const penaltyDelta = await this.getPenaltyDelta(tx);

    if (outcome === 'SUCCESS') {
      await this.bumpUsers(
        tx,
        [order.buyerId, order.sellerId],
        successDelta,
        'cap',
        {
          orderId: order.id,
          reason: 'تکمیل موفق معامله',
          source: 'order_success',
        },
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
          -penaltyDelta,
          'floor',
          {
            orderId: order.id,
            reason: 'شکست یا لغو معامله',
            source: 'order_failure',
          },
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

  /** کسر امتیاز برای رد آگهی یا موارد مشابه (فقط فروشنده/نویسنده) */
  async penalizeUsers(
    tx: Prisma.TransactionClient,
    userIds: string[],
    delta?: number,
    context?: { orderId?: string; reason?: string; source?: string },
  ): Promise<void> {
    if (!userIds.length) return;
    const penaltyDelta =
      delta ?? -(await this.getPenaltyDelta(tx));
    await this.bumpUsers(tx, userIds, penaltyDelta, 'floor', context);
  }

  private async getSuccessDelta(
    tx: Prisma.TransactionClient,
  ): Promise<number> {
    return this.readPositiveSetting(
      tx,
      'TRADE_REPUTATION_SUCCESS_DELTA',
      TRADE_REPUTATION_SUCCESS_DELTA,
    );
  }

  private async getPenaltyDelta(
    tx: Prisma.TransactionClient,
  ): Promise<number> {
    return this.readPositiveSetting(
      tx,
      'TRADE_REPUTATION_PENALTY_DELTA',
      TRADE_REPUTATION_PENALTY_DELTA,
    );
  }

  private async readPositiveSetting(
    tx: Prisma.TransactionClient,
    key: string,
    fallback: number,
  ): Promise<number> {
    const row = await tx.systemSetting.findUnique({
      where: { key },
      select: { value: true },
    });
    const parsed = Number(row?.value ?? fallback);
    if (!Number.isFinite(parsed) || parsed <= 0) return fallback;
    return parsed;
  }

  private async bumpUsers(
    tx: Prisma.TransactionClient,
    userIds: string[],
    delta: number,
    mode: 'cap' | 'floor',
    context?: { orderId?: string; listingId?: string; reason?: string; source?: string },
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
      await this.userRatingHistory.record(tx, {
        userId,
        previous: current,
        next,
        reason:
          context?.reason ??
          (delta > 0
            ? 'افزایش امتیاز اعتماد پس از تکمیل موفق معامله'
            : 'کاهش امتیاز اعتماد پس از شکست یا لغو معامله'),
        source: context?.source ?? 'order_reputation',
        orderId: context?.orderId,
        listingId: context?.listingId,
      });
    }
  }
}
