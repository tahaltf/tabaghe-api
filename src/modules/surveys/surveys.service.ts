import { randomBytes } from 'crypto';
import {
  BadRequestException,
  GoneException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import {
  OrderStatus,
  Prisma,
  SurveyRole,
} from '@prisma/client';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { readPositiveIntSetting } from '../../common/system-settings/numeric-setting.util';
import { getFrontendAppOrigin } from '../../common/pwa-brand-icon.util';
import { SETTING_KEYS } from '../admin/services/admin-settings.service';
import { OperationalNotifyService } from '../notification/operational-notify.service';
import { SubmitSurveyDto } from './dto/submit-survey.dto';

const DEFAULT_DELAY_HOURS = 24;
const DEFAULT_EXPIRE_DAYS = 30;
const MAX_COMMENT_LENGTH = 2000;
const SEND_BATCH_SIZE = 50;

export type PublicSurveyView = {
  role: SurveyRole;
  listingTitle: string;
  alreadyResponded: boolean;
  expired: boolean;
  score: number | null;
};

@Injectable()
export class SurveysService {
  private readonly logger = new Logger(SurveysService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly operationalNotify: OperationalNotifyService,
  ) {}

  private newToken(): string {
    return randomBytes(24).toString('hex');
  }

  private surveyPath(token: string): string {
    return `/survey/${token}`;
  }

  private surveyAbsoluteUrl(token: string): string {
    return `${getFrontendAppOrigin()}${this.surveyPath(token)}`;
  }

  private async isFeatureEnabled(): Promise<boolean> {
    const row = await this.prisma.systemSetting.findUnique({
      where: { key: SETTING_KEYS.POST_PURCHASE_SURVEY_ENABLED },
      select: { value: true },
    });
    if (!row?.value?.trim()) return true;
    const v = row.value.trim().toLowerCase();
    return v === 'true' || v === '1' || v === 'yes';
  }

  /** تأخیر ارسال؛ ۰ مجاز است (ارسال در کرون بعدی). */
  private async readDelayHours(): Promise<number> {
    const row = await this.prisma.systemSetting.findUnique({
      where: { key: SETTING_KEYS.POST_PURCHASE_SURVEY_DELAY_HOURS },
      select: { value: true },
    });
    if (!row?.value?.trim()) return DEFAULT_DELAY_HOURS;
    const parsed = Number(row.value);
    if (!Number.isFinite(parsed) || parsed < 0) return DEFAULT_DELAY_HOURS;
    return Math.floor(parsed);
  }

  async createForCompletedOrder(orderId: string): Promise<void> {
    if (!(await this.isFeatureEnabled())) return;

    const order = await this.prisma.order.findUnique({
      where: { id: orderId },
      select: {
        id: true,
        status: true,
        buyerId: true,
        sellerId: true,
        completedAt: true,
      },
    });
    if (!order || order.status !== OrderStatus.COMPLETED) return;

    const existing = await this.prisma.postPurchaseSurvey.count({
      where: { orderId: order.id },
    });
    if (existing > 0) return;

    const delayHours = await this.readDelayHours();
    const expireDays = await readPositiveIntSetting(
      this.prisma,
      SETTING_KEYS.POST_PURCHASE_SURVEY_EXPIRE_DAYS,
      DEFAULT_EXPIRE_DAYS,
    );

    const base = order.completedAt ?? new Date();
    const scheduledSendAt = new Date(base.getTime() + delayHours * 60 * 60 * 1000);
    const expiresAt = new Date(base.getTime() + expireDays * 24 * 60 * 60 * 1000);

    try {
      await this.prisma.postPurchaseSurvey.createMany({
        data: [
          {
            orderId: order.id,
            userId: order.buyerId,
            role: SurveyRole.BUYER,
            token: this.newToken(),
            scheduledSendAt,
            expiresAt,
          },
          {
            orderId: order.id,
            userId: order.sellerId,
            role: SurveyRole.SELLER,
            token: this.newToken(),
            scheduledSendAt,
            expiresAt,
          },
        ],
        skipDuplicates: true,
      });
    } catch (err) {
      this.logger.warn(
        `Failed to create post-purchase surveys for order ${orderId}: ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
    }
  }

  async processDueSends(): Promise<number> {
    if (!(await this.isFeatureEnabled())) return 0;

    const now = new Date();
    const due = await this.prisma.postPurchaseSurvey.findMany({
      where: {
        sentAt: null,
        scheduledSendAt: { lte: now },
        OR: [{ expiresAt: null }, { expiresAt: { gt: now } }],
      },
      take: SEND_BATCH_SIZE,
      orderBy: { scheduledSendAt: 'asc' },
      include: {
        order: {
          select: {
            id: true,
            listingId: true,
            listing: { select: { title: true } },
          },
        },
      },
    });

    let sent = 0;
    for (const invite of due) {
      const listingTitle = invite.order.listing?.title?.trim() || 'معامله';
      const surveyUrl = this.surveyAbsoluteUrl(invite.token);
      const path = this.surveyPath(invite.token);
      try {
        await this.operationalNotify.notifyPostPurchaseSurvey({
          userId: invite.userId,
          role: invite.role,
          orderId: invite.orderId,
          listingId: invite.order.listingId,
          listingTitle,
          surveyUrl,
          surveyPath: path,
        });
        await this.prisma.postPurchaseSurvey.update({
          where: { id: invite.id },
          data: { sentAt: new Date() },
        });
        sent += 1;
      } catch (err) {
        this.logger.warn(
          `Failed to send survey ${invite.id}: ${
            err instanceof Error ? err.message : String(err)
          }`,
        );
      }
    }
    return sent;
  }

  async getByToken(token: string): Promise<PublicSurveyView> {
    const invite = await this.prisma.postPurchaseSurvey.findUnique({
      where: { token },
      include: {
        order: { select: { listing: { select: { title: true } } } },
      },
    });
    if (!invite) {
      throw new NotFoundException('لینک نظرسنجی معتبر نیست');
    }

    const expired =
      invite.expiresAt != null && invite.expiresAt.getTime() <= Date.now();
    const alreadyResponded = invite.respondedAt != null;

    if (!invite.openedAt && !alreadyResponded && !expired) {
      await this.prisma.postPurchaseSurvey
        .update({
          where: { id: invite.id },
          data: { openedAt: new Date() },
        })
        .catch(() => undefined);
    }

    return {
      role: invite.role,
      listingTitle: invite.order.listing?.title?.trim() || 'معامله',
      alreadyResponded,
      expired,
      /** فقط امتیاز خود پاسخ‌دهنده؛ نظر طرف مقابل هرگز از این API برنمی‌گردد */
      score: alreadyResponded ? invite.score : null,
    };
  }

  async submitByToken(token: string, dto: SubmitSurveyDto) {
    const invite = await this.prisma.postPurchaseSurvey.findUnique({
      where: { token },
    });
    if (!invite) {
      throw new NotFoundException('لینک نظرسنجی معتبر نیست');
    }
    if (invite.expiresAt && invite.expiresAt.getTime() <= Date.now()) {
      throw new GoneException('مهلت پاسخ به این نظرسنجی به پایان رسیده است');
    }
    if (invite.respondedAt) {
      throw new BadRequestException('قبلاً به این نظرسنجی پاسخ داده‌اید');
    }

    const comment =
      typeof dto.comment === 'string' ? dto.comment.trim() : undefined;
    if (comment && comment.length > MAX_COMMENT_LENGTH) {
      throw new BadRequestException(
        `توضیح حداکثر ${MAX_COMMENT_LENGTH} کاراکتر می‌تواند باشد`,
      );
    }

    const now = new Date();
    const result = await this.prisma.postPurchaseSurvey.updateMany({
      where: { id: invite.id, respondedAt: null },
      data: {
        score: dto.score,
        comment: comment || null,
        respondedAt: now,
        openedAt: invite.openedAt ?? now,
      },
    });
    if (result.count === 0) {
      throw new BadRequestException('قبلاً به این نظرسنجی پاسخ داده‌اید');
    }

    return {
      ok: true as const,
      id: invite.id,
      role: invite.role,
      score: dto.score,
      respondedAt: now,
    };
  }

  async adminList(params: {
    page?: number;
    pageSize?: number;
    role?: SurveyRole;
    status?: 'pending' | 'sent' | 'responded' | 'expired';
    orderId?: string;
    q?: string;
  }) {
    const page = Math.max(1, params.page ?? 1);
    const pageSize = Math.min(100, Math.max(1, params.pageSize ?? 20));
    const now = new Date();
    const finalWhere = this.buildAdminWhere(params, now);

    const [total, items] = await Promise.all([
      this.prisma.postPurchaseSurvey.count({ where: finalWhere }),
      this.prisma.postPurchaseSurvey.findMany({
        where: finalWhere,
        orderBy: [{ createdAt: 'desc' }],
        skip: (page - 1) * pageSize,
        take: pageSize,
        include: {
          user: {
            select: {
              id: true,
              phone: true,
              firstName: true,
              lastName: true,
              displayName: true,
            },
          },
          order: {
            select: {
              id: true,
              status: true,
              completedAt: true,
              listing: { select: { id: true, title: true } },
            },
          },
        },
      }),
    ]);

    return {
      items: items.map((row) => ({
        id: row.id,
        orderId: row.orderId,
        role: row.role,
        score: row.score,
        comment: row.comment,
        scheduledSendAt: row.scheduledSendAt,
        sentAt: row.sentAt,
        respondedAt: row.respondedAt,
        openedAt: row.openedAt,
        expiresAt: row.expiresAt,
        createdAt: row.createdAt,
        surveyPath: this.surveyPath(row.token),
        user: row.user,
        listingTitle: row.order.listing?.title ?? null,
        listingId: row.order.listing?.id ?? null,
        orderCompletedAt: row.order.completedAt,
      })),
      total,
      page,
      pageSize,
      totalPages: Math.max(1, Math.ceil(total / pageSize)),
    };
  }

  private buildAdminWhere(
    params: {
      role?: SurveyRole;
      status?: 'pending' | 'sent' | 'responded' | 'expired';
      orderId?: string;
      q?: string;
    },
    now: Date,
  ): Prisma.PostPurchaseSurveyWhereInput {
    const and: Prisma.PostPurchaseSurveyWhereInput[] = [];

    if (params.role) and.push({ role: params.role });
    if (params.orderId?.trim()) and.push({ orderId: params.orderId.trim() });

    if (params.q?.trim()) {
      const q = params.q.trim();
      and.push({
        OR: [
          { orderId: { contains: q } },
          { user: { phone: { contains: q } } },
          { user: { firstName: { contains: q, mode: 'insensitive' } } },
          { user: { lastName: { contains: q, mode: 'insensitive' } } },
          {
            order: {
              listing: { title: { contains: q, mode: 'insensitive' } },
            },
          },
        ],
      });
    }

    if (params.status === 'responded') {
      and.push({ respondedAt: { not: null } });
    } else if (params.status === 'sent') {
      and.push({ sentAt: { not: null }, respondedAt: null });
    } else if (params.status === 'pending') {
      and.push({
        sentAt: null,
        OR: [{ expiresAt: null }, { expiresAt: { gt: now } }],
      });
    } else if (params.status === 'expired') {
      and.push({ respondedAt: null, expiresAt: { lte: now } });
    }

    return and.length ? { AND: and } : {};
  }
}
