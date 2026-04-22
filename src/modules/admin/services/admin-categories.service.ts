import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../../infrastructure/prisma/prisma.service';
import {
  CreateCategoryDto,
  UpdateCategoryDto,
} from '../dto/admin-category.dto';

const CATEGORY_SELECT = {
  id: true,
  title: true,
  slug: true,
  icon: true,
  parentId: true,
  feePercentage: true,
  feeCap: true,
  feePercentageDirect: true,
  feeCapDirect: true,
  feePercentageAuction: true,
  feeCapAuction: true,
  auctionDepositPercent: true,
  createdAt: true,
  parent: { select: { id: true, title: true } },
  _count: { select: { listings: true, children: true } },
} satisfies Prisma.CategorySelect;

export type AdminCategoryItem = Prisma.CategoryGetPayload<{ select: typeof CATEGORY_SELECT }>;

@Injectable()
export class AdminCategoriesService {
  constructor(private readonly prisma: PrismaService) {}

  async list(search?: string): Promise<AdminCategoryItem[]> {
    const where: Prisma.CategoryWhereInput = {};
    if (search) {
      const s = search.trim();
      where.OR = [
        { title: { contains: s, mode: 'insensitive' } },
        { slug: { contains: s, mode: 'insensitive' } },
      ];
    }
    return this.prisma.category.findMany({
      where,
      select: CATEGORY_SELECT,
      orderBy: [{ parentId: 'asc' }, { title: 'asc' }],
    });
  }

  async detail(id: string): Promise<AdminCategoryItem> {
    const cat = await this.prisma.category.findUnique({
      where: { id },
      select: CATEGORY_SELECT,
    });
    if (!cat) throw new NotFoundException('دسته‌بندی یافت نشد');
    return cat;
  }

  async create(dto: CreateCategoryDto): Promise<AdminCategoryItem> {
    await this.ensureSlugUnique(dto.slug);
    if (dto.parentId) {
      await this.ensureParentExists(dto.parentId);
    }
    const feeDirect = dto.feePercentageDirect ?? dto.feePercentage ?? 5;
    const feeAuction = dto.feePercentageAuction ?? dto.feePercentage ?? 5;
    const capDirect = dto.feeCapDirect ?? dto.feeCap ?? 500000;
    const capAuction = dto.feeCapAuction ?? dto.feeCap ?? 500000;
    return this.prisma.category.create({
      data: {
        title: dto.title,
        slug: dto.slug,
        icon: dto.icon ?? null,
        parentId: dto.parentId ?? null,
        feePercentage: dto.feePercentage ?? feeDirect,
        feeCap: dto.feeCap ?? capDirect,
        feePercentageDirect: feeDirect,
        feeCapDirect: capDirect,
        feePercentageAuction: feeAuction,
        feeCapAuction: capAuction,
        auctionDepositPercent: dto.auctionDepositPercent ?? 10,
      },
      select: CATEGORY_SELECT,
    });
  }

  async update(id: string, dto: UpdateCategoryDto): Promise<AdminCategoryItem> {
    const existing = await this.prisma.category.findUnique({ where: { id } });
    if (!existing) throw new NotFoundException('دسته‌بندی یافت نشد');
    if (dto.slug && dto.slug !== existing.slug) {
      await this.ensureSlugUnique(dto.slug);
    }
    if (dto.parentId !== undefined && dto.parentId) {
      if (dto.parentId === id) {
        throw new BadRequestException('والد یک دسته نمی‌تواند خودش باشد');
      }
      await this.ensureParentExists(dto.parentId);
    }
    return this.prisma.category.update({
      where: { id },
      data: {
        title: dto.title ?? undefined,
        slug: dto.slug ?? undefined,
        icon: dto.icon === undefined ? undefined : dto.icon,
        parentId: dto.parentId === undefined ? undefined : dto.parentId,
        feePercentage: dto.feePercentage ?? undefined,
        feeCap: dto.feeCap ?? undefined,
        feePercentageDirect: dto.feePercentageDirect ?? undefined,
        feeCapDirect: dto.feeCapDirect ?? undefined,
        feePercentageAuction: dto.feePercentageAuction ?? undefined,
        feeCapAuction: dto.feeCapAuction ?? undefined,
        auctionDepositPercent: dto.auctionDepositPercent ?? undefined,
      },
      select: CATEGORY_SELECT,
    });
  }

  async remove(id: string): Promise<{ id: string }> {
    const counts = await this.prisma.category.findUnique({
      where: { id },
      select: { _count: { select: { listings: true, children: true } } },
    });
    if (!counts) throw new NotFoundException('دسته‌بندی یافت نشد');
    if (counts._count.listings > 0) {
      throw new ConflictException('این دسته دارای آگهی است و قابل حذف نیست');
    }
    if (counts._count.children > 0) {
      throw new ConflictException('ابتدا زیردسته‌ها را حذف کنید');
    }
    await this.prisma.category.delete({ where: { id } });
    return { id };
  }

  private async ensureSlugUnique(slug: string): Promise<void> {
    const exists = await this.prisma.category.findUnique({ where: { slug } });
    if (exists) throw new ConflictException('این slug قبلا استفاده شده است');
  }

  private async ensureParentExists(parentId: string): Promise<void> {
    const parent = await this.prisma.category.findUnique({ where: { id: parentId } });
    if (!parent) throw new BadRequestException('والد انتخاب‌شده یافت نشد');
  }
}
