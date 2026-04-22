import { Injectable, NotFoundException } from '@nestjs/common';
import { ListingType, Prisma } from '@prisma/client';
import { PrismaService } from '../../../infrastructure/prisma/prisma.service';
import {
  CreateFeeRuleDto,
  UpdateFeeRuleDto,
} from '../dto/admin-fee-rule.dto';

const FEE_INCLUDE = {
  category: { select: { id: true, title: true } },
} satisfies Prisma.FeeRuleInclude;

export type AdminFeeRuleItem = Prisma.FeeRuleGetPayload<{ include: typeof FEE_INCLUDE }>;

@Injectable()
export class AdminFeeRulesService {
  constructor(private readonly prisma: PrismaService) {}

  list(listingType?: ListingType, categoryId?: string): Promise<AdminFeeRuleItem[]> {
    const where: Prisma.FeeRuleWhereInput = {};
    if (listingType) where.listingType = listingType;
    if (categoryId) where.categoryId = categoryId;
    return this.prisma.feeRule.findMany({
      where,
      include: FEE_INCLUDE,
      orderBy: [{ listingType: 'asc' }, { minPrice: 'asc' }],
    });
  }

  create(dto: CreateFeeRuleDto): Promise<AdminFeeRuleItem> {
    return this.prisma.feeRule.create({
      data: {
        listingType: dto.listingType,
        categoryId: dto.categoryId ?? null,
        minPrice: dto.minPrice,
        maxPrice: dto.maxPrice ?? null,
        feePercent: dto.feePercent,
        feeFixed: dto.feeFixed,
        feeCap: dto.feeCap ?? null,
        auctionDepositPercent: dto.auctionDepositPercent ?? 5,
        isActive: dto.isActive ?? true,
      },
      include: FEE_INCLUDE,
    });
  }

  async update(id: string, dto: UpdateFeeRuleDto): Promise<AdminFeeRuleItem> {
    const existing = await this.prisma.feeRule.findUnique({ where: { id } });
    if (!existing) throw new NotFoundException('قانون کارمزد یافت نشد');
    return this.prisma.feeRule.update({
      where: { id },
      data: {
        listingType: dto.listingType ?? undefined,
        categoryId: dto.categoryId === undefined ? undefined : dto.categoryId,
        minPrice: dto.minPrice ?? undefined,
        maxPrice: dto.maxPrice === undefined ? undefined : dto.maxPrice,
        feePercent: dto.feePercent ?? undefined,
        feeFixed: dto.feeFixed ?? undefined,
        feeCap: dto.feeCap === undefined ? undefined : dto.feeCap,
        auctionDepositPercent: dto.auctionDepositPercent ?? undefined,
        isActive: dto.isActive ?? undefined,
      },
      include: FEE_INCLUDE,
    });
  }

  async remove(id: string): Promise<{ id: string }> {
    const existing = await this.prisma.feeRule.findUnique({ where: { id } });
    if (!existing) throw new NotFoundException('قانون کارمزد یافت نشد');
    await this.prisma.feeRule.delete({ where: { id } });
    return { id };
  }
}
