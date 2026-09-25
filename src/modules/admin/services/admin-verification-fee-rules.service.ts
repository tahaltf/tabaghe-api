import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma, VerificationFeeMode } from '@prisma/client';
import { PrismaService } from '../../../infrastructure/prisma/prisma.service';
import {
  CreateVerificationFeeRuleDto,
  UpdateVerificationFeeRuleDto,
} from '../dto/admin-verification-fee-rule.dto';

const INCLUDE = {
  category: { select: { id: true, title: true } },
} satisfies Prisma.VerificationFeeRuleInclude;

export type AdminVerificationFeeRuleItem = Prisma.VerificationFeeRuleGetPayload<{
  include: typeof INCLUDE;
}>;

@Injectable()
export class AdminVerificationFeeRulesService {
  constructor(private readonly prisma: PrismaService) {}

  list(categoryId?: string): Promise<AdminVerificationFeeRuleItem[]> {
    const where: Prisma.VerificationFeeRuleWhereInput = {};
    if (categoryId === 'null') {
      where.categoryId = null;
    } else if (categoryId) {
      where.categoryId = categoryId;
    }
    return this.prisma.verificationFeeRule.findMany({
      where,
      include: INCLUDE,
      orderBy: [{ categoryId: 'asc' }, { minPrice: 'asc' }],
    });
  }

  async create(
    dto: CreateVerificationFeeRuleDto,
  ): Promise<AdminVerificationFeeRuleItem> {
    this.assertModeValue(dto.mode, dto.feeValue);
    if (dto.maxPrice != null && dto.maxPrice < dto.minPrice) {
      throw new BadRequestException('حداکثر قیمت نمی‌تواند کمتر از حداقل باشد');
    }
    return this.prisma.verificationFeeRule.create({
      data: {
        categoryId: dto.categoryId ?? null,
        minPrice: dto.minPrice,
        maxPrice: dto.maxPrice ?? null,
        mode: dto.mode,
        feeValue: dto.feeValue,
        feeCap: dto.feeCap ?? null,
        feeFloor: dto.feeFloor ?? null,
        isActive: dto.isActive ?? true,
      },
      include: INCLUDE,
    });
  }

  async update(
    id: string,
    dto: UpdateVerificationFeeRuleDto,
  ): Promise<AdminVerificationFeeRuleItem> {
    const existing = await this.prisma.verificationFeeRule.findUnique({
      where: { id },
    });
    if (!existing) throw new NotFoundException('قانون کارشناسی یافت نشد');

    const mode = dto.mode ?? existing.mode;
    const feeValue =
      dto.feeValue !== undefined ? dto.feeValue : Number(existing.feeValue);
    this.assertModeValue(mode, feeValue);

    const minPrice =
      dto.minPrice !== undefined ? dto.minPrice : Number(existing.minPrice);
    const maxPrice =
      dto.maxPrice !== undefined
        ? dto.maxPrice
        : existing.maxPrice != null
          ? Number(existing.maxPrice)
          : null;
    if (maxPrice != null && maxPrice < minPrice) {
      throw new BadRequestException('حداکثر قیمت نمی‌تواند کمتر از حداقل باشد');
    }

    return this.prisma.verificationFeeRule.update({
      where: { id },
      data: {
        categoryId:
          dto.categoryId === undefined ? undefined : dto.categoryId,
        minPrice: dto.minPrice ?? undefined,
        maxPrice: dto.maxPrice === undefined ? undefined : dto.maxPrice,
        mode: dto.mode ?? undefined,
        feeValue: dto.feeValue ?? undefined,
        feeCap: dto.feeCap === undefined ? undefined : dto.feeCap,
        feeFloor: dto.feeFloor === undefined ? undefined : dto.feeFloor,
        isActive: dto.isActive ?? undefined,
      },
      include: INCLUDE,
    });
  }

  async remove(id: string): Promise<{ id: string }> {
    const existing = await this.prisma.verificationFeeRule.findUnique({
      where: { id },
    });
    if (!existing) throw new NotFoundException('قانون کارشناسی یافت نشد');
    await this.prisma.verificationFeeRule.delete({ where: { id } });
    return { id };
  }

  private assertModeValue(mode: VerificationFeeMode, feeValue: number): void {
    if (!Number.isFinite(feeValue) || feeValue < 0) {
      throw new BadRequestException('مقدار هزینه نامعتبر است');
    }
    if (mode === VerificationFeeMode.PERCENT && feeValue > 100) {
      throw new BadRequestException('درصد کارشناسی نمی‌تواند بیشتر از ۱۰۰ باشد');
    }
  }
}
