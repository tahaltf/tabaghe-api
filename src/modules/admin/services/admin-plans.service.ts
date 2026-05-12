import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../../infrastructure/prisma/prisma.service';
import { CreatePlanDto, UpdatePlanDto } from '../dto/admin-plan.dto';

const PLAN_INCLUDE = {
  rules: true,
  _count: { select: { purchases: true } },
} satisfies Prisma.PlanInclude;

export type AdminPlanItem = Prisma.PlanGetPayload<{ include: typeof PLAN_INCLUDE }>;

@Injectable()
export class AdminPlansService {
  constructor(private readonly prisma: PrismaService) {}

  list(): Promise<AdminPlanItem[]> {
    return this.prisma.plan.findMany({
      include: PLAN_INCLUDE,
      orderBy: { createdAt: 'desc' },
    });
  }

  async create(dto: CreatePlanDto): Promise<AdminPlanItem> {
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
          create: dto.rules.map((r) => ({ type: r.type, count: r.count })),
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
        await tx.planRule.deleteMany({ where: { planId: id } });
        await tx.planRule.createMany({
          data: dto.rules.map((r) => ({ planId: id, type: r.type, count: r.count })),
        });
      }

      return tx.plan.findUniqueOrThrow({ where: { id }, include: PLAN_INCLUDE });
    });
  }

  async remove(id: string): Promise<{ id: string }> {
    const plan = await this.prisma.plan.findUnique({
      where: { id },
      select: { _count: { select: { purchases: true } } },
    });
    if (!plan) throw new NotFoundException('پلن یافت نشد');
    if (plan._count.purchases > 0) {
      throw new ConflictException('این پلن خریداری شده و قابل حذف نیست؛ آن را غیرفعال کنید');
    }
    await this.prisma.plan.delete({ where: { id } });
    return { id };
  }
}
