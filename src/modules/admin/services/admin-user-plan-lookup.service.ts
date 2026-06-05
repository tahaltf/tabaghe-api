import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../../infrastructure/prisma/prisma.service';
import { BUILTIN_FREE_PLAN_ID } from '../../plans/builtin-free-plan-display';

export interface AdminUserPlanInfo {
  id: string;
  planId: string;
  title: string;
  status: string;
  isBuiltinFree: boolean;
  purchasedAt: Date;
  expiresAt: Date | null;
  daysRemaining: number | null;
  isActive: boolean;
}

@Injectable()
export class AdminUserPlanLookupService {
  constructor(private readonly prisma: PrismaService) {}

  /** نزدیک‌ترین خرید پلنِ فعال هر کاربر */
  async loadActivePlansForUsers(
    userIds: string[],
  ): Promise<Map<string, AdminUserPlanInfo>> {
    const result = new Map<string, AdminUserPlanInfo>();
    if (!userIds.length) return result;

    const now = new Date();
    const purchases = await this.prisma.userPlanPurchase.findMany({
      where: {
        userId: { in: userIds },
        status: 'ACTIVE',
        OR: [{ expiresAt: null }, { expiresAt: { gt: now } }],
      },
      include: { plan: true },
      orderBy: { expiresAt: 'asc' },
    });

    for (const p of purchases) {
      if (result.has(p.userId)) continue;
      const expiresAt = p.expiresAt ?? null;
      const daysRemaining = expiresAt
        ? Math.max(
            0,
            Math.ceil((expiresAt.getTime() - now.getTime()) / 86400000),
          )
        : null;
      result.set(p.userId, {
        id: p.id,
        planId: p.planId,
        title: p.plan?.title ?? 'پلن نامشخص',
        status: p.status,
        isBuiltinFree: p.planId === BUILTIN_FREE_PLAN_ID,
        purchasedAt: p.createdAt,
        expiresAt,
        daysRemaining,
        isActive: true,
      });
    }

    return result;
  }
}
