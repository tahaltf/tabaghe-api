import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import {
  Prisma,
  SellerLeadActivityType,
  SellerLeadLostReason,
  SellerLeadSource,
  SellerLeadStage,
  UserRole,
} from '@prisma/client';
import { PrismaService } from '../../../infrastructure/prisma/prisma.service';
import { ServerSecretConfigService } from '../../../shared/settings/server-secret-config.service';
import { normalizeIranMobile } from '../utils/admin-recipient.util';
import { AdminSmsIrService } from './admin-smsir.service';
import {
  AdminChangeSellerLeadStageDto,
  AdminConvertSellerLeadDto,
  AdminCreateSellerLeadActivityDto,
  AdminCreateSellerLeadDto,
  AdminImportSellerLeadsDto,
  AdminIngestDivarSellerLeadDto,
  AdminSellerLeadListQueryDto,
  AdminSellerLeadSmsDto,
  AdminUpdateSellerLeadDto,
} from '../dto/admin-seller-crm.dto';

const OPEN_STAGES: SellerLeadStage[] = [
  SellerLeadStage.NEW,
  SellerLeadStage.CONTACTED,
  SellerLeadStage.INTERESTED,
  SellerLeadStage.ONBOARDING,
];

const BOARD_STAGES: SellerLeadStage[] = [
  SellerLeadStage.NEW,
  SellerLeadStage.CONTACTED,
  SellerLeadStage.INTERESTED,
  SellerLeadStage.ONBOARDING,
  SellerLeadStage.WON,
  SellerLeadStage.LOST,
];

const LEAD_CARD_SELECT = {
  id: true,
  fullName: true,
  shopName: true,
  phone: true,
  city: true,
  province: true,
  categoryHint: true,
  source: true,
  stage: true,
  lostReason: true,
  nextFollowUpAt: true,
  convertedUserId: true,
  convertedAt: true,
  createdAt: true,
  updatedAt: true,
} satisfies Prisma.SellerLeadSelect;

@Injectable()
export class AdminSellerCrmService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly smsIr: AdminSmsIrService,
    private readonly secrets: ServerSecretConfigService,
  ) {}

  async list(query: AdminSellerLeadListQueryDto) {
    const page = Math.max(1, query.page ?? 1);
    const pageSize = Math.min(100, Math.max(1, query.pageSize ?? 20));
    const where = this.buildWhere(query);

    const [total, items] = await Promise.all([
      this.prisma.sellerLead.count({ where }),
      this.prisma.sellerLead.findMany({
        where,
        select: {
          ...LEAD_CARD_SELECT,
          notes: true,
          convertedUser: {
            select: {
              id: true,
              phone: true,
              firstName: true,
              lastName: true,
              displayName: true,
              shopSlug: true,
            },
          },
        },
        orderBy: [{ nextFollowUpAt: 'asc' }, { updatedAt: 'desc' }],
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
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

  async board() {
    const leads = await this.prisma.sellerLead.findMany({
      where: {},
      select: LEAD_CARD_SELECT,
      orderBy: [{ nextFollowUpAt: 'asc' }, { updatedAt: 'desc' }],
      take: 500,
    });

    const columns = BOARD_STAGES.map((stage) => ({
      stage,
      items: leads.filter((l) => l.stage === stage),
    }));

    return { columns };
  }

  async stats() {
    const now = new Date();
    const startOfToday = new Date(now);
    startOfToday.setHours(0, 0, 0, 0);
    const endOfToday = new Date(now);
    endOfToday.setHours(23, 59, 59, 999);

    const weekAgo = new Date(now);
    weekAgo.setDate(weekAgo.getDate() - 7);
    const monthAgo = new Date(now);
    monthAgo.setDate(monthAgo.getDate() - 30);

    const [
      byStage,
      bySource,
      followUpDue,
      followUpOverdue,
      wonWeek,
      wonMonth,
      total,
      wonWithDates,
    ] = await Promise.all([
      this.prisma.sellerLead.groupBy({
        by: ['stage'],
        _count: { _all: true },
      }),
      this.prisma.sellerLead.groupBy({
        by: ['source'],
        _count: { _all: true },
      }),
      this.prisma.sellerLead.count({
        where: {
          stage: { in: OPEN_STAGES },
          nextFollowUpAt: { gte: startOfToday, lte: endOfToday },
        },
      }),
      this.prisma.sellerLead.count({
        where: {
          stage: { in: OPEN_STAGES },
          nextFollowUpAt: { lt: startOfToday },
        },
      }),
      this.prisma.sellerLead.count({
        where: {
          stage: SellerLeadStage.WON,
          convertedAt: { gte: weekAgo },
        },
      }),
      this.prisma.sellerLead.count({
        where: {
          stage: SellerLeadStage.WON,
          convertedAt: { gte: monthAgo },
        },
      }),
      this.prisma.sellerLead.count(),
      this.prisma.sellerLead.findMany({
        where: {
          stage: SellerLeadStage.WON,
          convertedAt: { not: null },
        },
        select: { createdAt: true, convertedAt: true },
        take: 500,
      }),
    ]);

    const funnel = BOARD_STAGES.map((stage) => ({
      stage,
      count: byStage.find((r) => r.stage === stage)?._count._all ?? 0,
    }));

    const sourceBreakdown = Object.values(SellerLeadSource).map((source) => ({
      source,
      count: bySource.find((r) => r.source === source)?._count._all ?? 0,
    }));

    const wonTotal =
      byStage.find((r) => r.stage === SellerLeadStage.WON)?._count._all ?? 0;
    const conversionRate =
      total > 0 ? Math.round((wonTotal / total) * 1000) / 10 : 0;

    let avgDaysToConvert: number | null = null;
    if (wonWithDates.length > 0) {
      const sum = wonWithDates.reduce((acc, row) => {
        const end = row.convertedAt!.getTime();
        const start = row.createdAt.getTime();
        return acc + Math.max(0, end - start);
      }, 0);
      avgDaysToConvert =
        Math.round((sum / wonWithDates.length / (1000 * 60 * 60 * 24)) * 10) /
        10;
    }

    return {
      funnel,
      sourceBreakdown,
      followUpDue,
      followUpOverdue,
      wonWeek,
      wonMonth,
      total,
      wonTotal,
      conversionRate,
      avgDaysToConvert,
    };
  }

  /**
   * ثبت خودکار لید از کرالر دیوار.
   * لید باز تکراری → skipped (نه Conflict) تا کرالر اسپم نکند.
   */
  async ingestDivarLead(dto: AdminIngestDivarSellerLeadDto) {
    const phone = this.requirePhone(dto.phone);
    const existing = await this.prisma.sellerLead.findFirst({
      where: { phone, stage: { in: OPEN_STAGES } },
      select: { id: true, fullName: true, stage: true },
    });
    if (existing) {
      return {
        status: 'skipped' as const,
        reason: 'open_lead_exists',
        existingLeadId: existing.id,
        existingStage: existing.stage,
      };
    }

    const adminId = await this.resolveCrawlerAdminId();
    const fullName = this.resolveDivarFullName(dto.fullName);
    const notes = this.buildDivarNotes(dto);

    const matchedUser = await this.findUserByPhone(phone);
    const lead = await this.prisma.sellerLead.create({
      data: {
        fullName,
        shopName: dto.shopName?.trim() || null,
        phone,
        city: dto.city?.trim() || null,
        categoryHint: dto.categoryHint?.trim() || null,
        source: SellerLeadSource.DIVAR,
        notes,
        createdByAdminId: adminId,
        convertedUserId: matchedUser?.id ?? null,
        activities: {
          create: {
            type: SellerLeadActivityType.SYSTEM,
            body: 'ثبت خودکار از کرالر دیوار',
            createdByAdminId: adminId,
            meta: {
              adId: dto.adId?.trim() || undefined,
              adUrl: dto.adUrl?.trim() || undefined,
              ...(matchedUser ? { matchedUserId: matchedUser.id } : {}),
            },
          },
        },
      },
      select: {
        ...LEAD_CARD_SELECT,
        notes: true,
      },
    });

    return {
      status: 'created' as const,
      lead,
    };
  }

  async create(adminId: string, dto: AdminCreateSellerLeadDto) {
    const phone = this.requirePhone(dto.phone);
    await this.assertNoOpenLead(phone);

    const matchedUser = await this.findUserByPhone(phone);
    const nextFollowUpAt = dto.nextFollowUpAt
      ? new Date(dto.nextFollowUpAt)
      : null;

    const lead = await this.prisma.sellerLead.create({
      data: {
        fullName: dto.fullName.trim(),
        shopName: dto.shopName?.trim() || null,
        phone,
        city: dto.city?.trim() || null,
        province: dto.province?.trim() || null,
        categoryHint: dto.categoryHint?.trim() || null,
        source: dto.source ?? SellerLeadSource.OTHER,
        notes: dto.notes?.trim() || null,
        nextFollowUpAt,
        createdByAdminId: adminId,
        convertedUserId: matchedUser?.id ?? null,
        activities: {
          create: {
            type: SellerLeadActivityType.SYSTEM,
            body: 'لید ایجاد شد',
            createdByAdminId: adminId,
            meta: matchedUser
              ? { matchedUserId: matchedUser.id }
              : undefined,
          },
        },
      },
      select: {
        ...LEAD_CARD_SELECT,
        notes: true,
        convertedUser: {
          select: {
            id: true,
            phone: true,
            firstName: true,
            lastName: true,
            displayName: true,
            shopSlug: true,
          },
        },
      },
    });

    return {
      ...lead,
      matchedUser: matchedUser
        ? {
            id: matchedUser.id,
            phone: matchedUser.phone,
            firstName: matchedUser.firstName,
            lastName: matchedUser.lastName,
            displayName: matchedUser.displayName,
          }
        : null,
    };
  }

  async detail(id: string) {
    const lead = await this.prisma.sellerLead.findUnique({
      where: { id },
      include: {
        convertedUser: {
          select: {
            id: true,
            phone: true,
            firstName: true,
            lastName: true,
            displayName: true,
            shopSlug: true,
            sellerTermsAcceptedAt: true,
            _count: { select: { listings: true } },
          },
        },
        activities: {
          orderBy: { createdAt: 'desc' },
          take: 100,
          include: {
            createdByAdmin: {
              select: {
                id: true,
                firstName: true,
                lastName: true,
                displayName: true,
              },
            },
          },
        },
      },
    });
    if (!lead) throw new NotFoundException('لید یافت نشد');

    const matchedUser =
      lead.convertedUser ?? (await this.findUserByPhone(lead.phone));

    return { ...lead, matchedUser };
  }

  async update(adminId: string, id: string, dto: AdminUpdateSellerLeadDto) {
    const existing = await this.requireLead(id);
    const data: Prisma.SellerLeadUpdateInput = {};

    if (dto.fullName !== undefined) data.fullName = dto.fullName.trim();
    if (dto.shopName !== undefined)
      data.shopName = dto.shopName?.trim() || null;
    if (dto.city !== undefined) data.city = dto.city?.trim() || null;
    if (dto.province !== undefined)
      data.province = dto.province?.trim() || null;
    if (dto.categoryHint !== undefined)
      data.categoryHint = dto.categoryHint?.trim() || null;
    if (dto.source !== undefined) data.source = dto.source;
    if (dto.notes !== undefined) data.notes = dto.notes?.trim() || null;
    if (dto.nextFollowUpAt !== undefined) {
      data.nextFollowUpAt = dto.nextFollowUpAt
        ? new Date(dto.nextFollowUpAt)
        : null;
    }

    if (dto.phone !== undefined) {
      const phone = this.requirePhone(dto.phone);
      if (phone !== existing.phone) {
        await this.assertNoOpenLead(phone, id);
        data.phone = phone;
        const matched = await this.findUserByPhone(phone);
        data.convertedUser = matched
          ? { connect: { id: matched.id } }
          : { disconnect: true };
      }
    }

    const lead = await this.prisma.sellerLead.update({
      where: { id },
      data,
      select: { ...LEAD_CARD_SELECT, notes: true },
    });

    if (dto.nextFollowUpAt !== undefined) {
      await this.prisma.sellerLeadActivity.create({
        data: {
          leadId: id,
          type: SellerLeadActivityType.FOLLOW_UP_SET,
          body: dto.nextFollowUpAt
            ? `پیگیری بعدی: ${dto.nextFollowUpAt}`
            : 'پیگیری بعدی پاک شد',
          createdByAdminId: adminId,
          meta: { nextFollowUpAt: dto.nextFollowUpAt },
        },
      });
    }

    return lead;
  }

  async changeStage(
    adminId: string,
    id: string,
    dto: AdminChangeSellerLeadStageDto,
  ) {
    const existing = await this.requireLead(id);
    if (
      dto.stage === SellerLeadStage.LOST &&
      !dto.lostReason &&
      !existing.lostReason
    ) {
      throw new BadRequestException('برای از دست رفته، دلیل الزامی است');
    }

    const data: Prisma.SellerLeadUpdateInput = {
      stage: dto.stage,
    };

    if (dto.stage === SellerLeadStage.LOST) {
      data.lostReason = dto.lostReason ?? existing.lostReason;
    } else if (dto.stage !== SellerLeadStage.WON) {
      data.lostReason = null;
    }

    if (dto.stage === SellerLeadStage.WON) {
      const matched =
        existing.convertedUserId
          ? { id: existing.convertedUserId }
          : await this.findUserByPhone(existing.phone);
      if (matched) {
        data.convertedUser = { connect: { id: matched.id } };
      }
      data.convertedAt = existing.convertedAt ?? new Date();
      data.lostReason = null;
    }

    if (
      existing.stage === SellerLeadStage.WON &&
      dto.stage !== SellerLeadStage.WON
    ) {
      data.convertedAt = null;
    }

    const lead = await this.prisma.$transaction(async (tx) => {
      const updated = await tx.sellerLead.update({
        where: { id },
        data,
        select: { ...LEAD_CARD_SELECT, notes: true },
      });
      await tx.sellerLeadActivity.create({
        data: {
          leadId: id,
          type: SellerLeadActivityType.STAGE_CHANGE,
          body:
            dto.note?.trim() ||
            `تغییر مرحله: ${existing.stage} → ${dto.stage}`,
          createdByAdminId: adminId,
          meta: {
            from: existing.stage,
            to: dto.stage,
            lostReason: dto.lostReason ?? null,
          },
        },
      });
      return updated;
    });

    return lead;
  }

  async addActivity(
    adminId: string,
    id: string,
    dto: AdminCreateSellerLeadActivityDto,
  ) {
    await this.requireLead(id);

    const allowed: SellerLeadActivityType[] = [
      SellerLeadActivityType.NOTE,
      SellerLeadActivityType.CALL,
      SellerLeadActivityType.FOLLOW_UP_SET,
    ];
    if (!allowed.includes(dto.type)) {
      throw new BadRequestException('نوع فعالیت مجاز نیست');
    }

    if (
      (dto.type === SellerLeadActivityType.NOTE ||
        dto.type === SellerLeadActivityType.CALL) &&
      !dto.body?.trim()
    ) {
      throw new BadRequestException('متن فعالیت الزامی است');
    }

    return this.prisma.$transaction(async (tx) => {
      if (dto.nextFollowUpAt !== undefined) {
        await tx.sellerLead.update({
          where: { id },
          data: {
            nextFollowUpAt: dto.nextFollowUpAt
              ? new Date(dto.nextFollowUpAt)
              : null,
            ...(dto.type === SellerLeadActivityType.CALL &&
            (
              await tx.sellerLead.findUnique({
                where: { id },
                select: { stage: true },
              })
            )?.stage === SellerLeadStage.NEW
              ? { stage: SellerLeadStage.CONTACTED }
              : {}),
          },
        });
      } else if (dto.type === SellerLeadActivityType.CALL) {
        const current = await tx.sellerLead.findUnique({
          where: { id },
          select: { stage: true },
        });
        if (current?.stage === SellerLeadStage.NEW) {
          await tx.sellerLead.update({
            where: { id },
            data: { stage: SellerLeadStage.CONTACTED },
          });
        }
      }

      return tx.sellerLeadActivity.create({
        data: {
          leadId: id,
          type: dto.type,
          body: dto.body?.trim() || null,
          createdByAdminId: adminId,
          meta:
            dto.nextFollowUpAt !== undefined
              ? { nextFollowUpAt: dto.nextFollowUpAt }
              : undefined,
        },
      });
    });
  }

  async sendSms(adminId: string, id: string, dto: AdminSellerLeadSmsDto) {
    const lead = await this.requireLead(id);
    const text = dto.messageText.trim();
    if (text.length < 2) {
      throw new BadRequestException('متن پیامک کوتاه است');
    }

    try {
      await this.smsIr.sendSimple({
        mobile: lead.phone,
        text,
        lineNumber: dto.lineNumber,
      });
    } catch (err) {
      const msg =
        err instanceof Error ? err.message : 'ارسال پیامک ناموفق بود';
      throw new BadRequestException(msg);
    }

    return this.prisma.$transaction(async (tx) => {
      if (lead.stage === SellerLeadStage.NEW) {
        await tx.sellerLead.update({
          where: { id },
          data: { stage: SellerLeadStage.CONTACTED },
        });
      }
      return tx.sellerLeadActivity.create({
        data: {
          leadId: id,
          type: SellerLeadActivityType.SMS,
          body: text,
          createdByAdminId: adminId,
          meta: { phone: lead.phone },
        },
      });
    });
  }

  async convert(adminId: string, id: string, dto: AdminConvertSellerLeadDto) {
    const lead = await this.requireLead(id);

    let userId = dto.userId?.trim() || lead.convertedUserId || null;
    if (!userId) {
      const matched = await this.findUserByPhone(lead.phone);
      userId = matched?.id ?? null;
    }

    if (userId) {
      const user = await this.prisma.user.findUnique({
        where: { id: userId },
        select: { id: true, phone: true },
      });
      if (!user) throw new BadRequestException('کاربر یافت نشد');
    }

    return this.prisma.$transaction(async (tx) => {
      const updated = await tx.sellerLead.update({
        where: { id },
        data: {
          stage: SellerLeadStage.WON,
          lostReason: null,
          convertedAt: new Date(),
          ...(userId
            ? { convertedUser: { connect: { id: userId } } }
            : {}),
        },
        select: {
          ...LEAD_CARD_SELECT,
          notes: true,
          convertedUser: {
            select: {
              id: true,
              phone: true,
              firstName: true,
              lastName: true,
              displayName: true,
              shopSlug: true,
            },
          },
        },
      });

      await tx.sellerLeadActivity.create({
        data: {
          leadId: id,
          type: SellerLeadActivityType.STAGE_CHANGE,
          body:
            dto.note?.trim() ||
            (userId
              ? 'تبدیل به فروشنده فعال و لینک به کاربر'
              : 'علامت‌گذاری به‌عنوان فروشنده فعال (کاربر یافت نشد)'),
          createdByAdminId: adminId,
          meta: {
            from: lead.stage,
            to: SellerLeadStage.WON,
            convertedUserId: userId,
          },
        },
      });

      return updated;
    });
  }

  async remove(adminId: string, id: string) {
    await this.requireLead(id);
    await this.prisma.sellerLead.delete({ where: { id } });
    return { ok: true, deletedBy: adminId };
  }

  async importCsv(adminId: string, dto: AdminImportSellerLeadsDto) {
    const lines = dto.text
      .split(/\r?\n/)
      .map((l) => l.trim())
      .filter((l) => l.length > 0);

    let created = 0;
    let skipped = 0;
    const errors: string[] = [];

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      if (i === 0 && /name|نام|phone|موبایل/i.test(line)) {
        continue;
      }
      const parts = line.split(/[,;\t]/).map((p) => p.trim());
      const fullName = parts[0] || '';
      const phoneRaw = parts[1] || '';
      const shopName = parts[2] || undefined;
      const city = parts[3] || undefined;
      const sourceRaw = (parts[4] || '').toUpperCase();

      const phone = normalizeIranMobile(phoneRaw);
      if (!fullName || !phone) {
        skipped++;
        errors.push(`خط ${i + 1}: نام یا موبایل نامعتبر`);
        continue;
      }

      const source = this.parseSource(sourceRaw) ?? dto.defaultSource ?? SellerLeadSource.OTHER;

      try {
        await this.assertNoOpenLead(phone);
        const matchedUser = await this.findUserByPhone(phone);
        await this.prisma.sellerLead.create({
          data: {
            fullName,
            shopName: shopName || null,
            phone,
            city: city || null,
            source,
            createdByAdminId: adminId,
            convertedUserId: matchedUser?.id ?? null,
            activities: {
              create: {
                type: SellerLeadActivityType.SYSTEM,
                body: 'واردات از CSV',
                createdByAdminId: adminId,
              },
            },
          },
        });
        created++;
      } catch (err) {
        skipped++;
        errors.push(
          `خط ${i + 1}: ${err instanceof Error ? err.message : 'خطا'}`,
        );
      }
    }

    return { created, skipped, errors: errors.slice(0, 20) };
  }

  private buildWhere(
    query: AdminSellerLeadListQueryDto,
  ): Prisma.SellerLeadWhereInput {
    const where: Prisma.SellerLeadWhereInput = {};
    if (query.stage) where.stage = query.stage;
    if (query.source) where.source = query.source;

    const q = query.q?.trim();
    if (q) {
      where.OR = [
        { fullName: { contains: q, mode: 'insensitive' } },
        { shopName: { contains: q, mode: 'insensitive' } },
        { phone: { contains: q.replace(/\D/g, '') || q } },
        { city: { contains: q, mode: 'insensitive' } },
        { categoryHint: { contains: q, mode: 'insensitive' } },
      ];
    }

    if (query.followUpDue) {
      const endOfToday = new Date();
      endOfToday.setHours(23, 59, 59, 999);
      where.stage = query.stage
        ? query.stage
        : { in: OPEN_STAGES };
      where.nextFollowUpAt = { lte: endOfToday };
    }

    return where;
  }

  private requirePhone(raw: string): string {
    const phone = normalizeIranMobile(raw);
    if (!phone) {
      throw new BadRequestException('شماره موبایل معتبر نیست (مثال: 09123456789)');
    }
    return phone;
  }

  private async assertNoOpenLead(phone: string, excludeId?: string) {
    const existing = await this.prisma.sellerLead.findFirst({
      where: {
        phone,
        stage: { in: OPEN_STAGES },
        ...(excludeId ? { id: { not: excludeId } } : {}),
      },
      select: { id: true, fullName: true, stage: true },
    });
    if (existing) {
      throw new ConflictException(
        `لید باز برای این شماره وجود دارد: ${existing.fullName} (${existing.stage})`,
      );
    }
  }

  private async requireLead(id: string) {
    const lead = await this.prisma.sellerLead.findUnique({ where: { id } });
    if (!lead) throw new NotFoundException('لید یافت نشد');
    return lead;
  }

  private async findUserByPhone(phone: string) {
    return this.prisma.user.findUnique({
      where: { phone },
      select: {
        id: true,
        phone: true,
        firstName: true,
        lastName: true,
        displayName: true,
        shopSlug: true,
      },
    });
  }

  private parseSource(raw: string): SellerLeadSource | null {
    if (!raw) return null;
    if (Object.values(SellerLeadSource).includes(raw as SellerLeadSource)) {
      return raw as SellerLeadSource;
    }
    const map: Record<string, SellerLeadSource> = {
      اینستاگرام: SellerLeadSource.INSTAGRAM,
      INSTAGRAM: SellerLeadSource.INSTAGRAM,
      بازار: SellerLeadSource.BAZAAR_VISIT,
      حضوری: SellerLeadSource.BAZAAR_VISIT,
      معرفی: SellerLeadSource.REFERRAL,
      وبسایت: SellerLeadSource.WEBSITE,
      دیوار: SellerLeadSource.DIVAR,
      تلگرام: SellerLeadSource.TELEGRAM,
    };
    return map[raw] ?? map[raw.toLowerCase()] ?? null;
  }

  private resolveDivarFullName(raw?: string): string {
    const trimmed = (raw ?? '').trim().replace(/\s+/g, ' ');
    if (trimmed.length >= 2) {
      return trimmed.slice(0, 120);
    }
    return 'فروشنده دیوار';
  }

  private buildDivarNotes(dto: AdminIngestDivarSellerLeadDto): string | null {
    const parts: string[] = [];
    const adUrl = dto.adUrl?.trim();
    const adId = dto.adId?.trim();
    const extra = dto.notes?.trim();
    if (adUrl) parts.push(`آگهی: ${adUrl}`);
    if (adId) parts.push(`شناسه دیوار: ${adId}`);
    if (extra) parts.push(extra);
    if (parts.length === 0) return null;
    return parts.join('\n').slice(0, 2000);
  }

  private async resolveCrawlerAdminId(): Promise<string> {
    const configured = this.secrets.get('SELLER_CRM_CRAWLER_ADMIN_ID')?.trim();
    if (configured) {
      const user = await this.prisma.user.findFirst({
        where: { id: configured, role: UserRole.ADMIN },
        select: { id: true },
      });
      if (!user) {
        throw new ServiceUnavailableException(
          'SELLER_CRM_CRAWLER_ADMIN_ID معتبر نیست یا ادمین نیست',
        );
      }
      return user.id;
    }

    const fallback = await this.prisma.user.findFirst({
      where: { role: UserRole.ADMIN },
      orderBy: { createdAt: 'asc' },
      select: { id: true },
    });
    if (!fallback) {
      throw new ServiceUnavailableException(
        'هیچ ادمینی برای ثبت لید کرالر یافت نشد — SELLER_CRM_CRAWLER_ADMIN_ID را تنظیم کنید',
      );
    }
    return fallback.id;
  }
}
