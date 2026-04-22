import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { NotificationType, Prisma, RepairRequestStatus } from '@prisma/client';
import { existsSync, unlink } from 'fs';
import { join } from 'path';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { NotificationService } from '../notification/notification.service';
import {
  ConfirmRepairResultDto,
  SelectRepairSlotDto,
  ShipRepairDto,
  SubmitRepairDto,
} from './dto/repair.dto';

const PROCESS_CWD_UPLOADS = join(process.cwd(), 'uploads');

@Injectable()
export class RepairService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly notifications: NotificationService,
  ) {}

  // ---------------------------------------------------------------------------
  // Helpers
  // ---------------------------------------------------------------------------

  private genTrackingCode() {
    return `REP-${Math.random().toString(36).substring(2, 8).toUpperCase()}`;
  }

  private parseKeepList(raw?: string): string[] {
    if (!raw) return [];
    try {
      const parsed = JSON.parse(raw);
      return Array.isArray(parsed) ? parsed.filter((x) => typeof x === 'string') : [];
    } catch {
      // fall back to comma-separated values
      return raw.split(',').map((s) => s.trim()).filter(Boolean);
    }
  }

  private deleteFile(relPath: string) {
    if (!relPath) return;
    try {
      const safe = relPath.replace(/\\/g, '/').replace(/^\/+/, '');
      const full = join(PROCESS_CWD_UPLOADS, safe.replace(/^uploads\//, ''));
      if (existsSync(full)) unlink(full, () => undefined);
    } catch {
      /* non-fatal */
    }
  }

  private async ensureOwnership(userId: string, repairId: string) {
    const repair = await this.prisma.repairRequest.findUnique({ where: { id: repairId } });
    if (!repair) throw new NotFoundException('درخواست تعمیر یافت نشد');
    if (repair.userId !== userId) throw new ForbiddenException('عدم دسترسی');
    return repair;
  }

  private async resolveRepairDeviceType(raw: string): Promise<string> {
    const input = (raw || '').trim();
    if (!input) throw new BadRequestException('نوع کالا الزامی است');

    const setting = await this.prisma.systemSetting.findUnique({
      where: { key: 'REPAIR_ALLOWED_CATEGORY_IDS' },
      select: { value: true },
    });

    if (!setting?.value?.trim()) {
      throw new BadRequestException('دسته‌بندی مجاز تعمیرات توسط ادمین تنظیم نشده است');
    }

    let allowedIds: string[] = [];
    try {
      const parsed = JSON.parse(setting.value);
      if (Array.isArray(parsed)) {
        allowedIds = parsed.filter((x): x is string => typeof x === 'string');
      }
    } catch {
      allowedIds = [];
    }

    if (!allowedIds.length) {
      throw new BadRequestException('هیچ دسته‌بندی مجاز تعمیراتی فعال نشده است');
    }

    const where: Prisma.CategoryWhereInput =
      allowedIds.length > 0
        ? {
            OR: [{ id: { in: allowedIds } }, { parentId: { in: allowedIds } }],
          }
        : {};

    const categories = await this.prisma.category.findMany({
      where,
      select: {
        id: true,
        title: true,
        parent: { select: { title: true } },
      },
    });

    const byId = categories.find((c) => c.id === input);
    if (byId) return byId.parent ? `${byId.parent.title} / ${byId.title}` : byId.title;

    const byTitle = categories.find((c) => c.title === input);
    if (byTitle) return byTitle.parent ? `${byTitle.parent.title} / ${byTitle.title}` : byTitle.title;

    throw new BadRequestException('دسته‌بندی انتخاب‌شده برای تعمیرات معتبر نیست');
  }

  private async notifyOwner(
    userId: string,
    trackingCode: string,
    title: string,
    message: string,
    meta?: Record<string, unknown>,
  ) {
    try {
      await this.notifications.create({
        userId,
        type: NotificationType.REPAIR_STATUS_CHANGED,
        title,
        message,
        meta: { trackingCode, ...meta },
      });
    } catch {
      /* non-fatal */
    }
  }

  // ---------------------------------------------------------------------------
  // Create repair
  // ---------------------------------------------------------------------------

  async submit(
    userId: string,
    dto: SubmitRepairDto,
    imageFiles: Express.Multer.File[] = [],
    videoFiles: Express.Multer.File[] = [],
  ) {
    if (imageFiles.length > 6) throw new BadRequestException('حداکثر ۶ عکس مجاز است');
    if (videoFiles.length > 2) throw new BadRequestException('حداکثر ۲ ویدیو مجاز است');

    const images = imageFiles.map((f) => f.filename);
    const videos = videoFiles.map((f) => f.filename);

    const normalizedDeviceType = await this.resolveRepairDeviceType(dto.deviceType);

    const repair = await this.prisma.repairRequest.create({
      data: {
        userId,
        trackingCode: this.genTrackingCode(),
        deviceType: normalizedDeviceType,
        brand: dto.brand,
        model: dto.model,
        description: dto.description,
        images,
        videos,
        status: RepairRequestStatus.PENDING_REVIEW,
      },
    });

    await this.notifyOwner(
      userId,
      repair.trackingCode,
      'درخواست تعمیر ثبت شد',
      `درخواست شما با کد پیگیری ${repair.trackingCode} ثبت شد و در حال بررسی است.`,
      { repairId: repair.id, status: repair.status },
    );

    return repair;
  }

  // ---------------------------------------------------------------------------
  // Edit (only allowed while PENDING_REVIEW or REJECTED)
  // ---------------------------------------------------------------------------

  async edit(
    userId: string,
    repairId: string,
    dto: SubmitRepairDto,
    imageFiles: Express.Multer.File[] = [],
    videoFiles: Express.Multer.File[] = [],
  ) {
    const repair = await this.ensureOwnership(userId, repairId);
    const editable: RepairRequestStatus[] = [
      RepairRequestStatus.PENDING_REVIEW,
      RepairRequestStatus.REJECTED,
    ];
    if (!editable.includes(repair.status)) {
      throw new BadRequestException('درخواست در این وضعیت قابل ویرایش نیست');
    }

    const keepImages = this.parseKeepList(dto.keepImages);
    const keepVideos = this.parseKeepList(dto.keepVideos);

    // delete removed ones
    for (const old of repair.images) {
      if (!keepImages.includes(old)) this.deleteFile(`repairs/images/${old}`);
    }
    for (const old of repair.videos) {
      if (!keepVideos.includes(old)) this.deleteFile(`repairs/videos/${old}`);
    }

    const newImages = imageFiles.map((f) => f.filename);
    const newVideos = videoFiles.map((f) => f.filename);

    const nextImages = [...keepImages, ...newImages].slice(0, 6);
    const nextVideos = [...keepVideos, ...newVideos].slice(0, 2);

    const normalizedDeviceType = await this.resolveRepairDeviceType(dto.deviceType);

    return this.prisma.repairRequest.update({
      where: { id: repairId },
      data: {
        deviceType: normalizedDeviceType,
        brand: dto.brand,
        model: dto.model,
        description: dto.description,
        images: nextImages,
        videos: nextVideos,
        // Re-submit after a rejection resets the status
        status: RepairRequestStatus.PENDING_REVIEW,
        rejectionReason: null,
      },
    });
  }

  // ---------------------------------------------------------------------------
  // Queries
  // ---------------------------------------------------------------------------

  async listMine(
    userId: string,
    options: { page?: number; pageSize?: number } = {},
  ) {
    const page = Math.max(1, options.page ?? 1);
    const pageSize = Math.min(50, Math.max(1, options.pageSize ?? 20));
    const skip = (page - 1) * pageSize;

    const where = { userId };
    const [items, total] = await this.prisma.$transaction([
      this.prisma.repairRequest.findMany({
        where,
        skip,
        take: pageSize,
        orderBy: { createdAt: 'desc' },
        select: {
          id: true,
          trackingCode: true,
          deviceType: true,
          brand: true,
          model: true,
          status: true,
          estimatedCost: true,
          createdAt: true,
          updatedAt: true,
          selectedDeliveryTime: true,
        },
      }),
      this.prisma.repairRequest.count({ where }),
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

  async detail(userId: string, repairId: string) {
    const repair = await this.prisma.repairRequest.findUnique({
      where: { id: repairId },
      include: {
        tickets: {
          select: {
            id: true,
            subject: true,
            status: true,
            createdAt: true,
          },
          orderBy: { createdAt: 'desc' },
        },
      },
    });
    if (!repair) throw new NotFoundException('درخواست تعمیر یافت نشد');
    if (repair.userId !== userId) throw new ForbiddenException('عدم دسترسی');
    return repair;
  }

  // ---------------------------------------------------------------------------
  // User picks one of admin-provided slots
  // ---------------------------------------------------------------------------

  async selectSlot(userId: string, repairId: string, dto: SelectRepairSlotDto) {
    const repair = await this.ensureOwnership(userId, repairId);
    if (repair.status !== RepairRequestStatus.APPROVED) {
      throw new BadRequestException('ابتدا باید درخواست شما توسط ادمین تایید شود');
    }

    const selected = new Date(dto.selectedDeliveryTime);
    if (isNaN(selected.getTime())) throw new BadRequestException('زمان نامعتبر');

    // Validate that the selected datetime lies inside one of the advertised slots
    // (we compare against the start time only for simplicity, clients should send
    // the precise "from" date-time of the slot).
    const slots = (repair.availableSlots as Array<{ date: string; from: string; to: string }> | null) ?? [];
    if (slots.length) {
      const within = slots.some((s) => {
        const fromIso = `${s.date}T${s.from}:00`;
        const toIso = `${s.date}T${s.to}:00`;
        const from = new Date(fromIso);
        const to = new Date(toIso);
        return selected >= from && selected <= to;
      });
      if (!within) throw new BadRequestException('زمان انتخابی خارج از بازه‌های پیشنهادی است');
    }

    const updated = await this.prisma.repairRequest.update({
      where: { id: repairId },
      data: {
        selectedDeliveryTime: selected,
        status: RepairRequestStatus.DELIVERY_TIME_SELECTED,
      },
    });

    await this.notifyOwner(
      userId,
      updated.trackingCode,
      'زمان ارسال انتخاب شد',
      'زمان ارسال کالای شما ثبت شد. لطفاً در موعد مقرر کالا را ارسال کنید.',
      { repairId, status: updated.status },
    );

    return updated;
  }

  // ---------------------------------------------------------------------------
  // User marks the device as shipped (tracking code + video mandatory)
  // ---------------------------------------------------------------------------

  async markShippedByUser(
    userId: string,
    repairId: string,
    dto: ShipRepairDto,
    video?: Express.Multer.File,
  ) {
    const repair = await this.ensureOwnership(userId, repairId);

    if (repair.status !== RepairRequestStatus.DELIVERY_TIME_SELECTED) {
      throw new BadRequestException('ابتدا باید زمان ارسال را انتخاب کنید');
    }

    if (!video) {
      throw new BadRequestException('ویدیوی بسته‌بندی کالا الزامی است');
    }

    const updated = await this.prisma.repairRequest.update({
      where: { id: repairId },
      data: {
        shippingTrackingCode: dto.trackingCode,
        shippingVideo: video.filename,
        status: RepairRequestStatus.AWAITING_DELIVERY,
      },
    });

    await this.notifyOwner(
      userId,
      updated.trackingCode,
      'کالا ارسال شد',
      'ارسال کالا به هاب طبقه ثبت شد. پس از دریافت توسط تیم ما به شما اطلاع داده می‌شود.',
      { repairId, status: updated.status, shippingTrackingCode: dto.trackingCode },
    );

    return updated;
  }

  // ---------------------------------------------------------------------------
  // User approves / rejects the inspection result (and its estimated cost)
  // ---------------------------------------------------------------------------

  async respondToResult(
    userId: string,
    repairId: string,
    dto: ConfirmRepairResultDto,
  ) {
    const repair = await this.ensureOwnership(userId, repairId);
    if (repair.status !== RepairRequestStatus.RESULT_READY) {
      throw new BadRequestException('هنوز نتیجه کارشناسی اعلام نشده است');
    }

    if (dto.decision === 'REJECT') {
      const cancelled = await this.prisma.repairRequest.update({
        where: { id: repairId },
        data: {
          status: RepairRequestStatus.CANCELLED,
          userCostApproved: false,
          rejectionReason: dto.note || 'عدم موافقت کاربر با هزینه کارشناسی',
        },
      });
      await this.notifyOwner(
        userId,
        cancelled.trackingCode,
        'درخواست تعمیر لغو شد',
        'درخواست شما بر اساس عدم موافقت با هزینه کارشناسی لغو شد. کالا به نشانی شما بازگردانده خواهد شد.',
        { repairId, status: cancelled.status },
      );
      return cancelled;
    }

    const approved = await this.prisma.repairRequest.update({
      where: { id: repairId },
      data: {
        userCostApproved: true,
        status: RepairRequestStatus.IN_PROGRESS,
      },
    });
    await this.notifyOwner(
      userId,
      approved.trackingCode,
      'تعمیر کالای شما آغاز شد',
      'تایید هزینه کارشناسی ثبت شد. عملیات تعمیر در حال انجام است.',
      { repairId, status: approved.status },
    );
    return approved;
  }

  // ---------------------------------------------------------------------------
  // User confirms receipt of the returned device
  // ---------------------------------------------------------------------------

  async confirmReturnDelivery(userId: string, repairId: string) {
    const repair = await this.ensureOwnership(userId, repairId);
    if (repair.status !== RepairRequestStatus.SHIPPED_BACK) {
      throw new BadRequestException('کالا هنوز برای شما ارسال نشده است');
    }

    const updated = await this.prisma.repairRequest.update({
      where: { id: repairId },
      data: { status: RepairRequestStatus.COMPLETED },
    });

    await this.notifyOwner(
      userId,
      updated.trackingCode,
      'فرایند تعمیر کامل شد',
      'دریافت کالا ثبت شد. فرایند تعمیر شما با موفقیت خاتمه یافت.',
      { repairId, status: updated.status },
    );
    return updated;
  }

  // ---------------------------------------------------------------------------
  // User cancels a not-yet-shipped request
  // ---------------------------------------------------------------------------

  async cancelByUser(userId: string, repairId: string, reason?: string) {
    const repair = await this.ensureOwnership(userId, repairId);
    const cancellable: RepairRequestStatus[] = [
      RepairRequestStatus.PENDING_REVIEW,
      RepairRequestStatus.APPROVED,
      RepairRequestStatus.DELIVERY_TIME_SELECTED,
    ];
    if (!cancellable.includes(repair.status)) {
      throw new BadRequestException('در این وضعیت لغو درخواست ممکن نیست');
    }

    const updated = await this.prisma.repairRequest.update({
      where: { id: repairId },
      data: {
        status: RepairRequestStatus.CANCELLED,
        rejectionReason: reason ?? 'لغو توسط کاربر',
      },
    });
    return updated;
  }
}

// re-export for other modules that may rely on the old filename
export type RepairServicePublic = Prisma.RepairRequestGetPayload<object>;
