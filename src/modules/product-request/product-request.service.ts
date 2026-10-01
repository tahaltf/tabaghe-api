import {
  BadRequestException,
  Injectable,
} from '@nestjs/common';
import {
  NotificationType,
  Prisma,
  ProductRequestCondition,
  ProductRequestStatus,
} from '@prisma/client';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { NotificationService } from '../notification/notification.service';
import { SubmitProductRequestDto } from './dto/product-request.dto';

@Injectable()
export class ProductRequestService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly notifications: NotificationService,
  ) {}

  private genTrackingCode() {
    return `PR-${Math.random().toString(36).substring(2, 8).toUpperCase()}`;
  }

  private parseOptionalDecimal(raw?: string): Prisma.Decimal | null {
    if (raw == null || String(raw).trim() === '') return null;
    const n = Number(String(raw).replace(/,/g, ''));
    if (!Number.isFinite(n) || n < 0) {
      throw new BadRequestException('مبلغ بودجه نامعتبر است');
    }
    return new Prisma.Decimal(n);
  }

  private async resolveCategoryId(categoryId?: string): Promise<string | null> {
    const id = categoryId?.trim();
    if (!id) return null;
    const cat = await this.prisma.category.findFirst({
      where: { id, isActive: true },
      select: { id: true },
    });
    if (!cat) throw new BadRequestException('دسته‌بندی انتخاب‌شده معتبر نیست');
    return cat.id;
  }

  async submit(userId: string, dto: SubmitProductRequestDto) {
    const title = dto.title.trim();
    const description = dto.description.trim();
    if (title.length < 2) {
      throw new BadRequestException('عنوان کالا الزامی است');
    }
    if (description.length < 10) {
      throw new BadRequestException('توضیحات باید حداقل ۱۰ کاراکتر باشد');
    }

    const categoryId = await this.resolveCategoryId(dto.categoryId);
    const budgetMin = this.parseOptionalDecimal(dto.budgetMin);
    const budgetMax = this.parseOptionalDecimal(dto.budgetMax);
    if (budgetMin && budgetMax && budgetMin.gte(budgetMax)) {
      throw new BadRequestException('حداقل بودجه باید کمتر از حداکثر باشد');
    }
    const range = await this.getBudgetRange();
    const minN = budgetMin ? budgetMin.toNumber() : null;
    const maxN = budgetMax ? budgetMax.toNumber() : null;
    if (minN != null && (minN < range.min || minN > range.max)) {
      throw new BadRequestException('حداقل بودجه خارج از بازه مجاز است');
    }
    if (maxN != null && (maxN < range.min || maxN > range.max)) {
      throw new BadRequestException('حداکثر بودجه خارج از بازه مجاز است');
    }

    const quantity =
      dto.quantity != null && Number.isFinite(dto.quantity)
        ? Math.max(1, Math.floor(dto.quantity))
        : 1;

    let condition: ProductRequestCondition | null = null;
    if (dto.condition) {
      condition = dto.condition;
    }

    let created: {
      id: string;
      trackingCode: string;
      status: ProductRequestStatus;
    } & Record<string, unknown>;

    for (let attempt = 0; attempt < 5; attempt++) {
      try {
        created = await this.prisma.productRequest.create({
          data: {
            userId,
            trackingCode: this.genTrackingCode(),
            categoryId,
            title,
            brand: dto.brand?.trim() || null,
            model: dto.model?.trim() || null,
            condition,
            budgetMin,
            budgetMax,
            quantity,
            description,
            images: [],
            status: ProductRequestStatus.PENDING,
          },
        });
        break;
      } catch (e: unknown) {
        const err = e as { code?: string };
        if (err?.code === 'P2002' && attempt < 4) continue;
        throw e;
      }
    }

    this.notifications
      .notifyAdminPersonnel({
        type: NotificationType.ADMIN_ALERT_NEW_PRODUCT_REQUEST,
        title: 'درخواست کالای جدید',
        message: `درخواست کالا با کد ${created!.trackingCode} ثبت شد.`,
        meta: {
          productRequestId: created!.id,
          trackingCode: created!.trackingCode,
          userId,
        },
      })
      .catch(() => undefined);

    return created!;
  }

  async listMine(
    userId: string,
    options: { page?: number; pageSize?: number } = {},
  ) {
    const page = Math.max(1, options.page ?? 1);
    const pageSize = Math.min(50, Math.max(1, options.pageSize ?? 20));
    const skip = (page - 1) * pageSize;
    const where = { userId };

    const [items, total] = await Promise.all([
      this.prisma.productRequest.findMany({
        where,
        skip,
        take: pageSize,
        orderBy: { createdAt: 'desc' },
        select: {
          id: true,
          trackingCode: true,
          title: true,
          brand: true,
          model: true,
          condition: true,
          budgetMin: true,
          budgetMax: true,
          quantity: true,
          description: true,
          status: true,
          createdAt: true,
          updatedAt: true,
          category: {
            select: {
              id: true,
              title: true,
              parent: { select: { id: true, title: true } },
            },
          },
        },
      }),
      this.prisma.productRequest.count({ where }),
    ]);

    return {
      items,
      pagination: {
        page,
        pageSize,
        total,
        totalPages: Math.max(1, Math.ceil(total / pageSize)),
      },
    };
  }

  async getBudgetRange(): Promise<{ min: number; max: number }> {
    const fallbackMin = 0;
    const fallbackMax = 800_000_000;
    const rows = await this.prisma.systemSetting.findMany({
      where: {
        key: {
          in: [
            'PRODUCT_REQUEST_BUDGET_RANGE_MIN',
            'PRODUCT_REQUEST_BUDGET_RANGE_MAX',
          ],
        },
      },
      select: { key: true, value: true },
    });
    let min = fallbackMin;
    let max = fallbackMax;
    for (const row of rows) {
      const n = Number(String(row.value ?? '').replace(/,/g, ''));
      if (!Number.isFinite(n) || n < 0) continue;
      if (row.key === 'PRODUCT_REQUEST_BUDGET_RANGE_MIN') min = Math.floor(n);
      if (row.key === 'PRODUCT_REQUEST_BUDGET_RANGE_MAX') max = Math.floor(n);
    }
    if (!(min < max)) {
      return { min: fallbackMin, max: fallbackMax };
    }
    return { min, max };
  }
}
