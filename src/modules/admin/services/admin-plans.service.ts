import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { ListingType, Prisma } from '@prisma/client';
import { PrismaService } from '../../../infrastructure/prisma/prisma.service';
import {
  CreatePlanDto,
  PlanRuleDto,
  UpdatePlanDto,
} from '../dto/admin-plan.dto';
import { buildBuiltinFreePlan } from '../../plans/builtin-free-plan';
import {
  BUILTIN_FREE_PLAN_DISPLAY_KEY,
  BUILTIN_FREE_PLAN_ID,
  buildBuiltinAdminRuleRows,
  parseBuiltinFreePlanDisplay,
  sanitizePlanBadgeColor,
  normalizePlanBadgeLabel,
} from '../../plans/builtin-free-plan-display';

const PLAN_INCLUDE = {
  rules: true,
  _count: { select: { purchases: true } },
} satisfies Prisma.PlanInclude;

export type AdminPlanItem = Prisma.PlanGetPayload<{
  include: typeof PLAN_INCLUDE;
}> & { isBuiltinFree?: boolean };

function normalizeMarketingTitle(
  value: string | undefined | null,
): string | null {
  if (value == null) return null;
  const t = value.trim();
  return t.length > 0 ? t : null;
}

/** چند ردیف با یک نوع آگهی را به یک ردیف با جمع تعداد تبدیل می‌کند (مطابق @@unique([planId, type])). */
function mergeRulesByType(
  rules: PlanRuleDto[],
): Array<{ type: ListingType; count: number }> {
  const map = new Map<ListingType, number>();
  for (const r of rules) {
    const n = Math.max(0, Math.floor(Number(r.count) || 0));
    map.set(r.type, (map.get(r.type) ?? 0) + n);
  }
  return Array.from(map.entries()).map(([type, count]) => ({ type, count }));
}

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

@Injectable()
export class AdminPlansService {
  constructor(private readonly prisma: PrismaService) {}

  private async getBuiltinQuotaLimits(): Promise<{
    direct: number;
    exchange: number;
  }> {
    const [directRow, exchangeRow] = await Promise.all([
      this.prisma.systemSetting.findUnique({
        where: { key: 'FREE_DIRECT_QUOTA' },
      }),
      this.prisma.systemSetting.findUnique({
        where: { key: 'FREE_EXCHANGE_QUOTA' },
      }),
    ]);
    const rawDirect = directRow ? Number(directRow.value) : 2;
    const rawExchange = exchangeRow ? Number(exchangeRow.value) : 1;
    return {
      direct: Number.isFinite(rawDirect)
        ? Math.max(0, Math.floor(rawDirect))
        : 2,
      exchange: Number.isFinite(rawExchange)
        ? Math.max(0, Math.floor(rawExchange))
        : 1,
    };
  }

  private async readBuiltinDisplayStore(): Promise<Record<string, unknown>> {
    const row = await this.prisma.systemSetting.findUnique({
      where: { key: BUILTIN_FREE_PLAN_DISPLAY_KEY },
    });
    if (!row?.value?.trim()) return {};
    try {
      const parsed: unknown = JSON.parse(row.value);
      return isPlainObject(parsed) ? { ...parsed } : {};
    } catch {
      return {};
    }
  }

  private async buildSyntheticBuiltinAdminItem(): Promise<AdminPlanItem> {
    const limits = await this.getBuiltinQuotaLimits();
    const row = await this.prisma.systemSetting.findUnique({
      where: { key: BUILTIN_FREE_PLAN_DISPLAY_KEY },
    });
    const overrides = parseBuiltinFreePlanDisplay(row?.value);
    const builtin = buildBuiltinFreePlan(limits, overrides);
    const rules = buildBuiltinAdminRuleRows(limits);
    const now = new Date();
    return {
      id: BUILTIN_FREE_PLAN_ID,
      title: builtin.title,
      marketingTitle: builtin.marketingTitle,
      description: builtin.description,
      price: 0,
      isActive: builtin.isActive,
      durationDays: 0,
      feeDiscountDirectPercent: 0,
      feeDiscountAuctionPercent: 0,
      badgeLabel: builtin.badgeLabel,
      badgeColor: builtin.badgeColor,
      createdAt: now,
      updatedAt: now,
      rules,
      _count: { purchases: 0 },
      isBuiltinFree: true,
    } as AdminPlanItem;
  }

  async list(): Promise<AdminPlanItem[]> {
    const [builtin, rows] = await Promise.all([
      this.buildSyntheticBuiltinAdminItem(),
      this.prisma.plan.findMany({
        include: PLAN_INCLUDE,
        orderBy: { createdAt: 'desc' },
      }),
    ]);
    return [builtin, ...rows.map((p) => ({ ...p, isBuiltinFree: false }))];
  }

  async findOne(id: string): Promise<AdminPlanItem> {
    if (id === BUILTIN_FREE_PLAN_ID) {
      return this.buildSyntheticBuiltinAdminItem();
    }
    const plan = await this.prisma.plan.findUnique({
      where: { id },
      include: PLAN_INCLUDE,
    });
    if (!plan) throw new NotFoundException('پلن یافت نشد');
    return { ...plan, isBuiltinFree: false };
  }

  async create(dto: CreatePlanDto): Promise<AdminPlanItem> {
    const merged = mergeRulesByType(dto.rules);
    if (merged.length === 0) {
      throw new BadRequestException(
        'حداقل یک قاعدهٔ سهمیه با تعداد معتبر لازم است',
      );
    }
    return this.prisma.plan
      .create({
        data: {
          title: dto.title,
          marketingTitle: normalizeMarketingTitle(dto.marketingTitle),
          description: dto.description,
          price: dto.price,
          isActive: dto.isActive ?? true,
          durationDays: dto.durationDays ?? 365,
          feeDiscountDirectPercent: dto.feeDiscountDirectPercent ?? 0,
          feeDiscountAuctionPercent: dto.feeDiscountAuctionPercent ?? 0,
          badgeLabel: normalizePlanBadgeLabel(dto.badgeLabel ?? null),
          badgeColor: sanitizePlanBadgeColor(dto.badgeColor),
          aiTokensPerMonth: dto.aiTokensPerMonth ?? 0,
          rules: {
            create: merged.map((r) => ({ type: r.type, count: r.count })),
          },
        },
        include: PLAN_INCLUDE,
      })
      .then((p) => ({ ...p, isBuiltinFree: false }));
  }

  private async updateBuiltinFreePlan(
    dto: UpdatePlanDto,
  ): Promise<AdminPlanItem> {
    const store = await this.readBuiltinDisplayStore();

    if (dto.title !== undefined) store.title = dto.title;
    if (dto.marketingTitle !== undefined) {
      store.marketingTitle = dto.marketingTitle;
    }
    if (dto.description !== undefined) {
      store.description = dto.description;
    }
    if (dto.isActive !== undefined) store.isActive = dto.isActive;
    if (dto.badgeLabel !== undefined) {
      store.badgeLabel = dto.badgeLabel?.trim() ? dto.badgeLabel.trim() : null;
    }
    if (dto.badgeColor !== undefined) {
      store.badgeColor = sanitizePlanBadgeColor(dto.badgeColor);
    }

    await this.prisma.$transaction(async (tx) => {
      if (dto.rules && dto.rules.length > 0) {
        const merged = mergeRulesByType(dto.rules);
        const directRow = merged.find((m) => m.type === ListingType.DIRECT);
        const exchangeRow = merged.find((m) => m.type === ListingType.EXCHANGE);
        const directCount = directRow?.count ?? 0;
        const exchangeCount = exchangeRow?.count ?? 0;
        await tx.systemSetting.upsert({
          where: { key: 'FREE_DIRECT_QUOTA' },
          create: {
            key: 'FREE_DIRECT_QUOTA',
            value: String(Math.max(0, directCount)),
            description: 'سهمیهٔ رایگان فروش مستقیم (همکف)',
          },
          update: { value: String(Math.max(0, directCount)) },
        });
        await tx.systemSetting.upsert({
          where: { key: 'FREE_EXCHANGE_QUOTA' },
          create: {
            key: 'FREE_EXCHANGE_QUOTA',
            value: String(Math.max(0, exchangeCount)),
            description: 'سهمیهٔ رایگان معاوضه (همکف)',
          },
          update: { value: String(Math.max(0, exchangeCount)) },
        });
      }

      await tx.systemSetting.upsert({
        where: { key: BUILTIN_FREE_PLAN_DISPLAY_KEY },
        create: {
          key: BUILTIN_FREE_PLAN_DISPLAY_KEY,
          value: JSON.stringify(store),
          description: 'تنظیمات نمایش پلن رایگان داخلی (JSON)',
        },
        update: { value: JSON.stringify(store) },
      });
    });

    return this.findOne(BUILTIN_FREE_PLAN_ID);
  }

  async update(id: string, dto: UpdatePlanDto): Promise<AdminPlanItem> {
    if (id === BUILTIN_FREE_PLAN_ID) {
      return this.updateBuiltinFreePlan(dto);
    }

    const existing = await this.prisma.plan.findUnique({ where: { id } });
    if (!existing) throw new NotFoundException('پلن یافت نشد');

    return this.prisma.$transaction(async (tx) => {
      await tx.plan.update({
        where: { id },
        data: {
          title: dto.title ?? undefined,
          marketingTitle:
            dto.marketingTitle !== undefined
              ? normalizeMarketingTitle(dto.marketingTitle)
              : undefined,
          description: dto.description ?? undefined,
          price: dto.price ?? undefined,
          isActive: dto.isActive ?? undefined,
          durationDays: dto.durationDays ?? undefined,
          feeDiscountDirectPercent: dto.feeDiscountDirectPercent ?? undefined,
          feeDiscountAuctionPercent: dto.feeDiscountAuctionPercent ?? undefined,
          badgeLabel:
            dto.badgeLabel !== undefined
              ? normalizePlanBadgeLabel(dto.badgeLabel)
              : undefined,
          badgeColor:
            dto.badgeColor !== undefined
              ? sanitizePlanBadgeColor(dto.badgeColor)
              : undefined,
          aiTokensPerMonth: dto.aiTokensPerMonth ?? undefined,
        },
      });

      if (dto.rules && dto.rules.length > 0) {
        const merged = mergeRulesByType(dto.rules);
        if (merged.length === 0) {
          throw new BadRequestException(
            'حداقل یک قاعدهٔ سهمیه با تعداد معتبر لازم است',
          );
        }
        await tx.planRule.deleteMany({ where: { planId: id } });
        await tx.planRule.createMany({
          data: merged.map((r) => ({
            planId: id,
            type: r.type,
            count: r.count,
          })),
        });
      }

      const plan = await tx.plan.findUniqueOrThrow({
        where: { id },
        include: PLAN_INCLUDE,
      });
      return { ...plan, isBuiltinFree: false };
    });
  }

  async remove(id: string): Promise<{ id: string }> {
    if (id === BUILTIN_FREE_PLAN_ID) {
      throw new BadRequestException('پلن رایگان پایه قابل حذف نیست');
    }
    const plan = await this.prisma.plan.findUnique({
      where: { id },
      select: { _count: { select: { purchases: true } } },
    });
    if (!plan) throw new NotFoundException('پلن یافت نشد');
    if (plan._count.purchases > 0) {
      throw new ConflictException(
        'این پلن خریداری شده و قابل حذف نیست؛ آن را غیرفعال کنید',
      );
    }
    await this.prisma.plan.delete({ where: { id } });
    return { id };
  }
}
