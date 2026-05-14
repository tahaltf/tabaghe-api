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

const PLAN_INCLUDE = {
  rules: true,
  _count: { select: { purchases: true } },
} satisfies Prisma.PlanInclude;

export type AdminPlanItem = Prisma.PlanGetPayload<{
  include: typeof PLAN_INCLUDE;
}>;

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

@Injectable()
export class AdminPlansService {
  constructor(private readonly prisma: PrismaService) {}

  list(): Promise<AdminPlanItem[]> {
    return this.prisma.plan.findMany({
      include: PLAN_INCLUDE,
      orderBy: { createdAt: 'desc' },
    });
  }

  async findOne(id: string): Promise<AdminPlanItem> {
    const plan = await this.prisma.plan.findUnique({
      where: { id },
      include: PLAN_INCLUDE,
    });
    if (!plan) throw new NotFoundException('پلن یافت نشد');
    return plan;
  }

  async create(dto: CreatePlanDto): Promise<AdminPlanItem> {
    const merged = mergeRulesByType(dto.rules);
    if (merged.length === 0) {
      throw new BadRequestException(
        'حداقل یک قاعدهٔ سهمیه با تعداد معتبر لازم است',
      );
    }
    return this.prisma.plan.create({
      data: {
        title: dto.title,
        description: dto.description,
        price: dto.price,
        isActive: dto.isActive ?? true,
        durationDays: dto.durationDays ?? 365,
        feeDiscountDirectPercent: dto.feeDiscountDirectPercent ?? 0,
        feeDiscountAuctionPercent: dto.feeDiscountAuctionPercent ?? 0,
        rules: {
          create: merged.map((r) => ({ type: r.type, count: r.count })),
        },
      },
      include: PLAN_INCLUDE,
    });
  }

  async update(id: string, dto: UpdatePlanDto): Promise<AdminPlanItem> {
    const existing = await this.prisma.plan.findUnique({ where: { id } });
    if (!existing) throw new NotFoundException('پلن یافت نشد');

    return this.prisma.$transaction(async (tx) => {
      await tx.plan.update({
        where: { id },
        data: {
          title: dto.title ?? undefined,
          description: dto.description ?? undefined,
          price: dto.price ?? undefined,
          isActive: dto.isActive ?? undefined,
          durationDays: dto.durationDays ?? undefined,
          feeDiscountDirectPercent: dto.feeDiscountDirectPercent ?? undefined,
          feeDiscountAuctionPercent: dto.feeDiscountAuctionPercent ?? undefined,
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

      return tx.plan.findUniqueOrThrow({
        where: { id },
        include: PLAN_INCLUDE,
      });
    });
  }

  async remove(id: string): Promise<{ id: string }> {
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
