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
const USER_SHIPPING_NOTE_MARK = '[USER_SHIPPING_NOTE]';
const ADMIN_RETURN_NOTE_MARK = '[ADMIN_RETURN_NOTE]';
const ADMIN_RETURN_PICKUP_TIME_MARK = '[ADMIN_RETURN_PICKUP_TIME]';
const ADMIN_RETURN_PICKUP_SLOTS_MARK = '[ADMIN_RETURN_PICKUP_SLOTS]';
const INTERNAL_PROFIT_MARK = '[INTERNAL_PROFIT]';

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

  private appendTaggedNote(base: string | null | undefined, marker: string, text?: string | null): string | null {
    const current = (base ?? '').trim();
    const note = (text ?? '').trim();
    if (!note) return current || null;
    const cleaned = current
      .split('\n')
      .filter((line) => !line.trim().startsWith(marker))
      .join('\n')
      .trim();
    return [cleaned, `${marker} ${note}`].filter(Boolean).join('\n\n').trim();
  }

  private extractTaggedNote(text: string | null | undefined, marker: string): string | null {
    const raw = (text ?? '').split('\n').find((line) => line.trim().startsWith(marker));
    if (!raw) return null;
    const extracted = raw.trim().slice(marker.length).trim();
    if (!extracted) return null;
    const normalized = extracted.replace(/^(note|message|text|adminNote)\s*[:=]\s*/i, '').trim();
    return normalized || null;
  }

  private stripTaggedNotes(text: string | null | undefined): string | null {
    const cleaned = (text ?? '')
      .split('\n')
      .filter((line) => {
        const t = line.trim();
        return !t.startsWith(USER_SHIPPING_NOTE_MARK)
          && !t.startsWith(ADMIN_RETURN_NOTE_MARK)
          && !t.startsWith(ADMIN_RETURN_PICKUP_TIME_MARK)
          && !t.startsWith(ADMIN_RETURN_PICKUP_SLOTS_MARK)
          && !t.startsWith(INTERNAL_PROFIT_MARK);
      })
      .join('\n')
      .trim();
    return cleaned || null;
  }

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
    return {
      ...repair,
      adminNote: this.stripTaggedNotes(repair.adminNote),
      userShippingNote: this.extractTaggedNote(repair.adminNote, USER_SHIPPING_NOTE_MARK),
      adminReturnNote: this.extractTaggedNote(repair.adminNote, ADMIN_RETURN_NOTE_MARK),
      inPersonPickupTime: this.extractTaggedNote(repair.adminNote, ADMIN_RETURN_PICKUP_TIME_MARK),
      inPersonPickupSlots: (() => {
        const raw = this.extractTaggedNote(repair.adminNote, ADMIN_RETURN_PICKUP_SLOTS_MARK);
        if (!raw) return null;
        try {
          const parsed = JSON.parse(raw);
          return Array.isArray(parsed) ? parsed.filter((x) => typeof x === 'string') : null;
        } catch {
          return null;
        }
      })(),
    } as AdminRepairItem;
  }

  // ---------------------------------------------------------------------------
  // Approve with slots & note
  // ---------------------------------------------------------------------------

  async approve(id: string, dto: AdminApproveRepairDto): Promise<AdminRepairItem> {
    const hasSlots = Array.isArray(dto.availableSlots) && dto.availableSlots.length > 0;
    const allowPostalDropOff = dto.allowPostalDropOff !== false;
    if (!hasSlots && !allowPostalDropOff) {
      throw new BadRequestException('حداقل یک زمان پیشنهادی یا گزینه ارسال پستی باید فعال باشد');
    }
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
      message: hasSlots
        ? 'درخواست شما تایید شد. لطفاً از بین زمان‌های پیشنهادی، یکی را انتخاب کنید.'
        : 'درخواست شما تایید شد. می‌توانید کالا را به‌صورت پستی ارسال کنید.',
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
    const existing = await this.prisma.repairRequest.findUnique({
      where: { id },
      select: { adminNote: true },
    });
    return this.transitionAndNotify({
      id,
      next: RepairRequestStatus.RESULT_READY,
      extra: {
        inspectionResult: dto.inspectionResult,
        estimatedCost: dto.estimatedCost ?? null,
        adminNote: this.appendTaggedNote(
          existing?.adminNote,
          INTERNAL_PROFIT_MARK,
          dto.internalProfit !== undefined ? String(dto.internalProfit) : null,
        ),
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
    const returnMethod = dto.returnMethod === 'IN_PERSON' ? 'IN_PERSON' : 'SHIP';
    if (returnMethod === 'SHIP' && !(dto.trackingCode ?? '').trim()) {
      throw new BadRequestException('کد رهگیری برای ارسال پستی الزامی است');
    }
    if (returnMethod === 'IN_PERSON' && !dto.inPersonPickupTime) {
      if (!dto.inPersonPickupSlots?.length) {
        throw new BadRequestException('حداقل یک زمان تحویل حضوری باید مشخص شود');
      }
    }
    const existing = await this.prisma.repairRequest.findUnique({
      where: { id },
      select: { adminNote: true },
    });
    return this.transitionAndNotify({
      id,
      next: RepairRequestStatus.SHIPPED_BACK,
      extra: {
        returnTrackingCode: returnMethod === 'IN_PERSON' ? 'IN_PERSON_PICKUP' : dto.trackingCode!.trim(),
        returnVideo: returnMethod === 'IN_PERSON' ? null : video?.filename,
        adminNote: this.appendTaggedNote(
          this.appendTaggedNote(
            this.appendTaggedNote(existing?.adminNote, ADMIN_RETURN_NOTE_MARK, dto.note),
            ADMIN_RETURN_PICKUP_TIME_MARK,
            returnMethod === 'IN_PERSON' ? dto.inPersonPickupTime : null,
          ),
          ADMIN_RETURN_PICKUP_SLOTS_MARK,
          returnMethod === 'IN_PERSON' && dto.inPersonPickupSlots?.length
            ? JSON.stringify(dto.inPersonPickupSlots)
            : null,
        ),
      },
      title: returnMethod === 'IN_PERSON' ? 'زمان تحویل حضوری ثبت شد' : 'کالا برای شما ارسال شد',
      message: returnMethod === 'IN_PERSON'
        ? (dto.inPersonPickupSlots?.length
          ? 'زمان‌های تحویل حضوری کالای شما ثبت شد. لطفاً یکی را انتخاب کنید.'
          : `زمان تحویل حضوری کالای شما برای ${dto.inPersonPickupTime} ثبت شد.`)
        : `کالای شما با کد رهگیری ${dto.trackingCode} ارسال شد.`,
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
