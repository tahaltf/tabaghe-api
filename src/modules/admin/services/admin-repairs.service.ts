import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { NotificationType, Prisma, RepairRequestStatus } from '@prisma/client';
import { PrismaService } from '../../../infrastructure/prisma/prisma.service';
import {
  buildPaginationMeta,
  PaginatedResult,
} from '../../../shared/contracts/pagination';
import { AdminRepairListQueryDto } from '../dto/admin-query.dto';
import {
  AdminApproveRepairDto,
  AdminRejectRepairDto,
  AdminSetResultDto,
  AdminShipBackDto,
} from '../dto/admin-repair.dto';
import { NotificationService } from '../../notification/notification.service';

const REPAIR_INCLUDE = {
  user: { select: { id: true, phone: true, firstName: true, lastName: true } },
} satisfies Prisma.RepairRequestInclude;

export type AdminRepairItem = Prisma.RepairRequestGetPayload<{
  include: typeof REPAIR_INCLUDE;
}>;

/** Admin-side valid next statuses for each repair status. */
const ALLOWED_ADMIN_TRANSITIONS: Record<RepairRequestStatus, RepairRequestStatus[]> = {
  PENDING_REVIEW: [RepairRequestStatus.APPROVED, RepairRequestStatus.REJECTED],
  REJECTED: [],
  APPROVED: [RepairRequestStatus.CANCELLED],
  DELIVERY_TIME_SELECTED: [RepairRequestStatus.RECEIVED_AT_HUB, RepairRequestStatus.CANCELLED],
  AWAITING_DELIVERY: [RepairRequestStatus.RECEIVED_AT_HUB, RepairRequestStatus.CANCELLED],
  RECEIVED_AT_HUB: [RepairRequestStatus.UNDER_INSPECTION, RepairRequestStatus.CANCELLED],
  UNDER_INSPECTION: [RepairRequestStatus.RESULT_READY, RepairRequestStatus.CANCELLED],
  RESULT_READY: [RepairRequestStatus.CANCELLED],
  IN_PROGRESS: [RepairRequestStatus.READY_TO_SHIP, RepairRequestStatus.CANCELLED],
  READY_TO_SHIP: [RepairRequestStatus.SHIPPED_BACK, RepairRequestStatus.CANCELLED],
  SHIPPED_BACK: [RepairRequestStatus.COMPLETED],
  COMPLETED: [],
  CANCELLED: [],
};

@Injectable()
export class AdminRepairsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly notifications: NotificationService,
  ) {}

  // ---------------------------------------------------------------------------
  // Queries
  // ---------------------------------------------------------------------------

  async list(query: AdminRepairListQueryDto): Promise<PaginatedResult<AdminRepairItem>> {
    const page = query.page ?? 1;
    const pageSize = query.pageSize ?? 20;
    const skip = (page - 1) * pageSize;

    const where: Prisma.RepairRequestWhereInput = {};
    if (query.status) where.status = query.status;
    if (query.search) {
      const s = query.search.trim();
      where.OR = [
        { trackingCode: { contains: s, mode: 'insensitive' } },
        { brand: { contains: s, mode: 'insensitive' } },
        { model: { contains: s, mode: 'insensitive' } },
        { deviceType: { contains: s, mode: 'insensitive' } },
        { user: { phone: { contains: s } } },
      ];
    }

    const [items, total] = await Promise.all([
      this.prisma.repairRequest.findMany({
        where,
        include: REPAIR_INCLUDE,
        orderBy: { createdAt: 'desc' },
        skip,
        take: pageSize,
      }),
      this.prisma.repairRequest.count({ where }),
    ]);

    return { items, pagination: buildPaginationMeta(page, pageSize, total) };
  }

  async detail(id: string): Promise<AdminRepairItem> {
    const repair = await this.prisma.repairRequest.findUnique({
      where: { id },
      include: REPAIR_INCLUDE,
    });
    if (!repair) throw new NotFoundException('درخواست تعمیر یافت نشد');
    return repair;
  }

  // ---------------------------------------------------------------------------
  // Approve with slots & note
  // ---------------------------------------------------------------------------

  async approve(id: string, dto: AdminApproveRepairDto): Promise<AdminRepairItem> {
    // basic validation: each slot's from < to
    for (const slot of dto.availableSlots) {
      if (slot.from >= slot.to) {
        throw new BadRequestException('ساعت پایان باید بعد از ساعت شروع باشد');
      }
    }

    return this.transitionAndNotify({
      id,
      next: RepairRequestStatus.APPROVED,
      extra: {
        availableSlots: dto.availableSlots as unknown as Prisma.InputJsonValue,
        adminNote: dto.adminNote ?? null,
        rejectionReason: null,
      },
      title: 'درخواست تعمیر تایید شد',
      message: 'درخواست شما تایید شد. لطفاً از بین زمان‌های پیشنهادی، یکی را انتخاب کنید.',
    });
  }

  async reject(id: string, dto: AdminRejectRepairDto): Promise<AdminRepairItem> {
    return this.transitionAndNotify({
      id,
      next: RepairRequestStatus.REJECTED,
      extra: { rejectionReason: dto.rejectionReason },
      title: 'درخواست تعمیر رد شد',
      message: `درخواست شما رد شد. دلیل: ${dto.rejectionReason}`,
    });
  }

  async markReceived(id: string): Promise<AdminRepairItem> {
    return this.transitionAndNotify({
      id,
      next: RepairRequestStatus.RECEIVED_AT_HUB,
      extra: {},
      title: 'کالا به هاب رسید',
      message: 'کالای شما توسط تیم طبقه دریافت شد و وارد مرحله بررسی می‌شود.',
    });
  }

  async startInspection(id: string): Promise<AdminRepairItem> {
    return this.transitionAndNotify({
      id,
      next: RepairRequestStatus.UNDER_INSPECTION,
      extra: {},
      title: 'بررسی کالا آغاز شد',
      message: 'کارشناسی کالای شما در حال انجام است.',
    });
  }

  async setResult(id: string, dto: AdminSetResultDto): Promise<AdminRepairItem> {
    return this.transitionAndNotify({
      id,
      next: RepairRequestStatus.RESULT_READY,
      extra: {
        inspectionResult: dto.inspectionResult,
        estimatedCost: dto.estimatedCost ?? null,
      },
      title: 'نتیجه کارشناسی اعلام شد',
      message:
        dto.estimatedCost !== undefined
          ? `نتیجه کارشناسی اعلام شد. برآورد هزینه: ${dto.estimatedCost.toLocaleString('fa-IR')} تومان. لطفاً تایید یا رد کنید.`
          : 'نتیجه کارشناسی اعلام شد. لطفاً تایید یا رد کنید.',
    });
  }

  async markReadyToShip(id: string): Promise<AdminRepairItem> {
    return this.transitionAndNotify({
      id,
      next: RepairRequestStatus.READY_TO_SHIP,
      extra: {},
      title: 'تعمیر تکمیل شد',
      message: 'کالای شما تعمیر شد و آماده ارسال برگشتی است.',
    });
  }

  async shipBack(
    id: string,
    dto: AdminShipBackDto,
    video?: Express.Multer.File,
  ): Promise<AdminRepairItem> {
    if (!video) {
      throw new BadRequestException('ویدیوی بسته‌بندی برای ارسال برگشتی الزامی است');
    }
    return this.transitionAndNotify({
      id,
      next: RepairRequestStatus.SHIPPED_BACK,
      extra: {
        returnTrackingCode: dto.trackingCode,
        returnVideo: video.filename,
      },
      title: 'کالا برای شما ارسال شد',
      message: `کالای شما با کد رهگیری ${dto.trackingCode} ارسال شد.`,
    });
  }

  async cancel(id: string, reason?: string): Promise<AdminRepairItem> {
    return this.transitionAndNotify({
      id,
      next: RepairRequestStatus.CANCELLED,
      extra: { rejectionReason: reason ?? 'لغو توسط ادمین' },
      title: 'درخواست تعمیر لغو شد',
      message: reason ?? 'درخواست شما توسط تیم پشتیبانی لغو شد.',
    });
  }

  async complete(id: string): Promise<AdminRepairItem> {
    return this.transitionAndNotify({
      id,
      next: RepairRequestStatus.COMPLETED,
      extra: {},
      title: 'فرایند تعمیر تکمیل شد',
      message: 'فرایند تعمیر توسط ادمین تکمیل شد.',
    });
  }

  // ---------------------------------------------------------------------------
  // Internal helpers
  // ---------------------------------------------------------------------------

  private async transitionAndNotify(params: {
    id: string;
    next: RepairRequestStatus;
    extra: Prisma.RepairRequestUpdateInput;
    title: string;
    message: string;
  }): Promise<AdminRepairItem> {
    const existing = await this.prisma.repairRequest.findUnique({
      where: { id: params.id },
    });
    if (!existing) throw new NotFoundException('درخواست تعمیر یافت نشد');

    const allowed = ALLOWED_ADMIN_TRANSITIONS[existing.status] ?? [];
    if (!allowed.includes(params.next)) {
      throw new BadRequestException(
        `تغییر وضعیت از «${existing.status}» به «${params.next}» مجاز نیست`,
      );
    }

    const updated = await this.prisma.repairRequest.update({
      where: { id: params.id },
      data: { status: params.next, ...params.extra },
      include: REPAIR_INCLUDE,
    });

    try {
      await this.notifications.create({
        userId: updated.userId,
        type: NotificationType.REPAIR_STATUS_CHANGED,
        title: params.title,
        message: params.message,
        meta: {
          repairId: updated.id,
          trackingCode: updated.trackingCode,
          status: updated.status,
        },
      });
    } catch {
      /* non-fatal */
    }

    return updated;
  }
}
