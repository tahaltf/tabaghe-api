import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { NotificationType, Prisma, UserRole } from '@prisma/client';
import { SmsService } from '../sms/sms.service';
import webpush from 'web-push';

type SmsRule = {
  siteNotificationEnabled?: boolean;
  smsEnabled?: boolean;
  siteNotificationText?: string;
  smsTemplateConfig?: {
    templateId: number;
    parameters?: Array<{ name: string; value: string }>;
  };
};
type PushSubscriptionPayload = {
  endpoint: string;
  keys: { p256dh: string; auth: string };
};

@Injectable()
export class NotificationService {
  private readonly logger = new Logger(NotificationService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly smsService: SmsService,
  ) {}

  async create(params: {
    userId: string;
    type: NotificationType;
    title: string;
    message: string;
    meta?: Record<string, unknown>;
  }) {
    const { userId, type, title, message, meta } = params;
    const rule = await this.getRuleForType(type);
    if (rule && rule.siteNotificationEnabled === false) {
      return null;
    }
    const resolvedTitle = title?.trim();
    const resolvedMessage = rule?.siteNotificationText?.trim() || message;
    const metaValue =
      meta === undefined ? undefined : (meta as Prisma.InputJsonValue);

    // ۱. ثبت نوتیفیکیشن در دیتابیس (برای نمایش در پنل کاربری)
    const notification = await this.prisma.notification.create({
      data: {
        userId,
        type,
        title: resolvedTitle,
        message: resolvedMessage,
        meta: metaValue,
      },
    });

    // ۲. ارسال پیامک به صورت پس‌زمینه (آسنکرون)
    this.processSms(userId, type, meta).catch((err) => {
      this.logger.error('Failed to process SMS notification', err);
    });
    this.processPush(
      userId,
      resolvedTitle,
      resolvedMessage,
      '/dashboard/notifications',
    ).catch((err) => {
      this.logger.error('Failed to process push notification', err);
    });

    return notification;
  }

  /**
   * نوتیفیکیشن داخل سایت برای همهٔ ادمین‌ها + ارسال پیامک فقط به کاربران GODADMIN
   * (طبق قالب و فعال‌سازی همان نوع در SMS_NOTIFICATION_RULES).
   */
  async notifyAdminPersonnel(params: {
    type: NotificationType;
    title: string;
    message: string;
    meta?: Record<string, unknown>;
  }): Promise<void> {
    const { type, title, message, meta } = params;
    const rule = await this.getRuleForType(type);
    if (rule && rule.siteNotificationEnabled === false) {
      return;
    }
    const resolvedTitle = title?.trim();
    const resolvedMessage = rule?.siteNotificationText?.trim() || message;
    const metaValue =
      meta === undefined ? undefined : (meta as Prisma.InputJsonValue);

    const admins = await this.prisma.user.findMany({
      where: { role: { in: [UserRole.ADMIN, UserRole.GODADMIN] } },
      select: { id: true },
    });
    if (admins.length === 0) return;

    await this.prisma.notification.createMany({
      data: admins.map((a) => ({
        userId: a.id,
        type,
        title: resolvedTitle,
        message: resolvedMessage,
        meta: metaValue,
      })),
    });

    this.processSmsForGodadmins(type, meta).catch((err) => {
      this.logger.error('Failed to process admin SMS notification', err);
    });
    await Promise.all(
      admins.map((a) =>
        this.processPush(
          a.id,
          resolvedTitle ?? '',
          resolvedMessage ?? '',
          '/admin/notifications',
        ).catch((e) => {
          this.logger.warn(
            `Push admin notification failed for ${a.id}: ${String((e as Error)?.message ?? e)}`,
          );
        }),
      ),
    );
  }

  private async processSmsForGodadmins(
    type: NotificationType,
    meta?: Record<string, unknown>,
  ) {
    const rule = await this.getRuleForType(type);
    if (rule && rule.smsEnabled === false) return;

    const godadmins = await this.prisma.user.findMany({
      where: { role: UserRole.GODADMIN },
      select: { phone: true, firstName: true },
    });
    if (godadmins.length === 0) return;

    const metaForSms: Record<string, unknown> | undefined = meta
      ? { ...meta }
      : undefined;

    const subjectUserId =
      metaForSms && typeof metaForSms.userId === 'string'
        ? metaForSms.userId
        : undefined;
    let subjectFirstName: string | null = null;
    if (subjectUserId) {
      const u = await this.prisma.user.findUnique({
        where: { id: subjectUserId },
        select: { firstName: true, phone: true },
      });
      subjectFirstName = u?.firstName ?? null;
      if (u?.phone && metaForSms) {
        metaForSms.userPhone = u.phone;
      }
    }

    let listingTitle = 'یک آگهی';
    const listingId =
      metaForSms && typeof metaForSms.listingId === 'string'
        ? metaForSms.listingId
        : undefined;
    if (listingId) {
      const listing = await this.prisma.listing.findUnique({
        where: { id: listingId },
        select: { title: true },
      });
      if (listing) listingTitle = listing.title;
    }

    const templateFirstName = String(subjectFirstName ?? 'کاربر');

    let templateId: number | undefined;
    let parameters: { name: string; value: string }[] = [];

    if (rule?.smsTemplateConfig?.templateId) {
      templateId = Number(rule.smsTemplateConfig.templateId);
      const configured = Array.isArray(rule.smsTemplateConfig.parameters)
        ? rule.smsTemplateConfig.parameters
        : [];
      const metaFlat = this.flattenMetaForSms(metaForSms);
      parameters = configured
        .map((p) => ({
          name: String(p?.name ?? '').trim(),
          value: this.applySmsPlaceholders(
            String(p?.value ?? ''),
            templateFirstName,
            listingTitle,
            metaFlat,
          ),
        }))
        .filter((p) => p.name && p.value);
    } else {
      return;
    }

    if (!templateId || !Number.isFinite(templateId)) return;

    for (const ga of godadmins) {
      if (!ga.phone) continue;
      const paramsWithRecipient = parameters.map((p) => ({
        name: p.name,
        value: String(p.value).replace(
          /\{\{adminFirstName\}\}/g,
          String(ga.firstName ?? 'ادمین'),
        ),
      }));
      try {
        await this.smsService.sendByTemplate(ga.phone, templateId, paramsWithRecipient);
        this.logger.log(`پیامک ${type} برای GODADMIN ${ga.phone} ارسال شد.`);
      } catch (error: unknown) {
        const err = error as { response?: { data?: unknown }; message?: string };
        this.logger.error(
          `خطا در ارسال پیامک ادمین به ${ga.phone}:`,
          err?.response?.data || err?.message,
        );
      }
    }
  }

  private flattenMetaForSms(
    meta?: Record<string, unknown>,
  ): Record<string, string> {
    const out: Record<string, string> = {};
    if (!meta) return out;
    for (const [k, v] of Object.entries(meta)) {
      out[k] = v === null || v === undefined ? '' : String(v);
    }
    return out;
  }

  private applySmsPlaceholders(
    raw: string,
    firstName: string,
    listingTitle: string,
    metaFlat: Record<string, string>,
  ): string {
    let s = String(raw ?? '');
    s = s.replace(/\{\{firstName\}\}/g, firstName);
    s = s.replace(/\{\{listingTitle\}\}/g, listingTitle);
    for (const [k, v] of Object.entries(metaFlat)) {
      s = s.replace(new RegExp(`\\{\\{${k}\\}\\}`, 'g'), v);
    }
    return s;
  }

  private async processSms(
    userId: string,
    type: NotificationType,
    meta?: Record<string, unknown>,
  ) {
    const rule = await this.getRuleForType(type);
    if (rule && rule.smsEnabled === false) return;

    // دریافت شماره موبایل کاربر
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { phone: true, firstName: true },
    });

    if (!user || !user.phone) return;

    // دریافت عنوان آگهی برای شخصی‌سازی پیامک
    let listingTitle = 'یک آگهی';
    const listingId =
      meta && typeof meta.listingId === 'string' ? meta.listingId : undefined;
    if (listingId) {
      const listing = await this.prisma.listing.findUnique({
        where: { id: listingId },
        select: { title: true },
      });
      if (listing) listingTitle = listing.title;
    }

    let templateId: number | undefined;
    let parameters: { name: string; value: string }[] = [];

    if (rule?.smsTemplateConfig?.templateId) {
      templateId = Number(rule.smsTemplateConfig.templateId);
      const configured = Array.isArray(rule.smsTemplateConfig.parameters)
        ? rule.smsTemplateConfig.parameters
        : [];
      parameters = configured
        .map((p) => ({
          name: String(p?.name ?? '').trim(),
          value: String(p?.value ?? '')
            .replace(/\{\{firstName\}\}/g, String(user.firstName ?? 'کاربر'))
            .replace(/\{\{listingTitle\}\}/g, listingTitle),
        }))
        .filter((p) => p.name && p.value);
    } else {
      switch (type) {
        case NotificationType.AUCTION_WON:
          templateId = 100001; // عدد واقعی قالب را از sms.ir اینجا بگذار
          parameters = [{ name: 'ITEM', value: listingTitle }];
          break;
        case NotificationType.AUCTION_LOST:
          templateId = 100002;
          parameters = [{ name: 'ITEM', value: listingTitle }];
          break;
        case NotificationType.AUCTION_PENALIZED:
          templateId = 100003;
          parameters = [{ name: 'ITEM', value: listingTitle }];
          break;
        default:
          return; // برای تایپ‌های دیگر پیامک نمی‌دهیم
      }
    }

    if (!templateId || !Number.isFinite(templateId)) return;
    try {
      await this.smsService.sendByTemplate(user.phone, templateId, parameters);
      this.logger.log(`پیامک ${type} برای شماره ${user.phone} ارسال شد.`);
    } catch (error: unknown) {
      const err = error as { response?: { data?: unknown }; message?: string };
      this.logger.error(
        `خطا در ارسال پیامک به ${user.phone}:`,
        err?.response?.data || err?.message,
      );
    }
  }

  listForUser(userId: string) {
    return this.prisma.notification.findMany({
      where: { userId },
      orderBy: { createdAt: 'desc' },
    });
  }

  async listForUserPaginated(
    userId: string,
    opts: { page: number; pageSize: number; onlyUnread?: boolean },
  ) {
    const page = Math.max(1, opts.page || 1);
    const pageSize = Math.min(100, Math.max(1, opts.pageSize || 20));
    const where = {
      userId,
      ...(opts.onlyUnread ? { isRead: false } : {}),
    };
    const [items, total] = await Promise.all([
      this.prisma.notification.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
      this.prisma.notification.count({ where }),
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

  unreadCount(userId: string) {
    return this.prisma.notification.count({
      where: { userId, isRead: false },
    });
  }

  async broadcast(params: {
    title: string;
    message: string;
    userIds?: string[]; // undefined => همه کاربران
    alsoSendSms?: boolean;
    smsTemplateConfig?: {
      templateId: number;
      parameters?: Array<{ name: string; value: string }>;
    };
  }) {
    const { title, message, userIds, alsoSendSms, smsTemplateConfig } = params;
    let recipients: { id: string }[];
    if (userIds && userIds.length > 0) {
      recipients = await this.prisma.user.findMany({
        where: { id: { in: userIds } },
        select: { id: true },
      });
    } else {
      recipients = await this.prisma.user.findMany({ select: { id: true } });
    }
    if (recipients.length === 0) return { created: 0 };
    await this.prisma.notification.createMany({
      data: recipients.map((u) => ({
        userId: u.id,
        type: NotificationType.ADMIN_ANNOUNCEMENT,
        title,
        message,
      })),
    });
    if (alsoSendSms && smsTemplateConfig?.templateId) {
      const users = await this.prisma.user.findMany({
        where: { id: { in: recipients.map((r) => r.id) } },
        select: { phone: true, firstName: true },
      });
      await Promise.all(
        users.map((u) =>
          this.smsService
            .sendByTemplate(
              u.phone,
              Number(smsTemplateConfig.templateId),
              (smsTemplateConfig.parameters ?? []).map((p) => ({
                name: String(p?.name ?? ''),
                value: String(p?.value ?? '')
                  .replace(/\{\{firstName\}\}/g, String(u.firstName ?? 'کاربر'))
                  .replace(/\{\{title\}\}/g, title),
              })),
            )
            .catch((err) => {
              this.logger.warn(
                `SMS broadcast failed for ${u.phone}: ${String(err?.message ?? err)}`,
              );
            }),
        ),
      );
    }
    await Promise.all(
      recipients.map((u) =>
        this.processPush(
          u.id,
          title,
          message,
          '/dashboard/notifications',
        ).catch((err) => {
          this.logger.warn(
            `Push broadcast failed for user ${u.id}: ${String(err?.message ?? err)}`,
          );
        }),
      ),
    );
    return { created: recipients.length };
  }

  private async getRuleForType(
    type: NotificationType,
  ): Promise<SmsRule | null> {
    try {
      const row = await this.prisma.systemSetting.findUnique({
        where: { key: 'SMS_NOTIFICATION_RULES' },
        select: { value: true },
      });
      if (!row?.value) return null;
      const parsed = JSON.parse(row.value) as Record<string, SmsRule>;
      const rule = parsed?.[String(type)];
      return rule && typeof rule === 'object' ? rule : null;
    } catch {
      return null;
    }
  }

  async markAsRead(userId: string, id: string) {
    const notification = await this.prisma.notification.findUnique({
      where: { id },
    });
    if (!notification) return null;
    if (notification.userId !== userId) return false;
    return this.prisma.notification.update({
      where: { id },
      data: { isRead: true },
    });
  }

  markAllAsRead(userId: string) {
    return this.prisma.notification.updateMany({
      where: { userId, isRead: false },
      data: { isRead: true },
    });
  }

  async savePushSubscription(
    userId: string,
    subscription: PushSubscriptionPayload,
  ) {
    return this.prisma.systemSetting.upsert({
      where: { key: `PUSH_SUB_${userId}` },
      update: {
        value: JSON.stringify(subscription),
        description: 'Web push subscription',
      },
      create: {
        key: `PUSH_SUB_${userId}`,
        value: JSON.stringify(subscription),
        description: 'Web push subscription',
      },
    });
  }

  async removePushSubscription(userId: string) {
    await this.prisma.systemSetting.deleteMany({
      where: { key: `PUSH_SUB_${userId}` },
    });
    return { ok: true };
  }

  private async processPush(
    userId: string,
    title: string,
    message: string,
    url: string,
  ) {
    const setting = await this.prisma.systemSetting.findUnique({
      where: { key: `PUSH_SUB_${userId}` },
      select: { value: true },
    });
    if (!setting?.value) return;
    let subscription: PushSubscriptionPayload | null = null;
    try {
      subscription = JSON.parse(setting.value) as PushSubscriptionPayload;
    } catch {
      subscription = null;
    }
    if (!subscription?.endpoint) return;
    const vapidPublicKey = process.env.WEB_PUSH_VAPID_PUBLIC_KEY || '';
    const vapidPrivateKey = (
      process.env.WEB_PUSH_VAPID_PRIVATE_KEY || ''
    ).replace(/\\n/g, '\n');
    const vapidSubject =
      process.env.WEB_PUSH_VAPID_SUBJECT || 'mailto:support@tabagheh.com';
    if (!vapidPublicKey || !vapidPrivateKey) return;
    await this.sendWebPush(
      subscription,
      { title, message, url },
      {
        publicKey: vapidPublicKey,
        privateKey: vapidPrivateKey,
        subject: vapidSubject,
      },
    );
  }

  private async sendWebPush(
    subscription: PushSubscriptionPayload,
    payload: { title: string; message: string; url: string },
    vapid: { publicKey: string; privateKey: string; subject: string },
  ) {
    try {
      webpush.setVapidDetails(vapid.subject, vapid.publicKey, vapid.privateKey);
      await webpush.sendNotification(
        {
          endpoint: subscription.endpoint,
          keys: subscription.keys,
        },
        JSON.stringify(payload),
        { TTL: 60, urgency: 'normal' as any },
      );
    } catch (err: any) {
      this.logger.warn(
        `WebPush request failed: ${String(err?.message ?? err)}`,
      );
    }
  }
}
