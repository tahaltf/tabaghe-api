import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { NotificationType, Prisma, UserRole } from '@prisma/client';
import { SmsService } from '../sms/sms.service';
import { applySmsTemplatePlaceholders } from '../../common/sms/sms-placeholders.util';
import webpush from 'web-push';
import { getFrontendAppOrigin } from '../../common/pwa-brand-icon.util';
import { isVapidConfigured, resolveVapidKeys } from '../../common/push/vapid-keys.util';

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
    /** فقط برای broadcast یک‌باره؛ در غیر این صورت از SMS_NOTIFICATION_RULES استفاده می‌شود */
    smsOverride?: {
      templateId: number;
      parameters?: Array<{ name: string; value: string }>;
    };
  }) {
    const { userId, type, title, message, meta, smsOverride } = params;
    const rule = await this.getRuleForType(type);
    const siteEnabled = !(rule && rule.siteNotificationEnabled === false);
    const smsFromRule = this.isSmsRuleActive(rule);
    const smsFromOverride =
      !!smsOverride?.templateId && Number(smsOverride.templateId) > 0;

    const resolvedTitle = title?.trim();
    const resolvedMessage = rule?.siteNotificationText?.trim() || message;
    const enrichedMeta: Record<string, unknown> = {
      ...(meta ?? {}),
      title: resolvedTitle,
      message: resolvedMessage,
    };
    const metaValue = meta === undefined ? undefined : (enrichedMeta as Prisma.InputJsonValue);

    // Push مستقل از فعال بودن نوتیف سایت/SMS است (فقط notifyPush کاربر + اشتراک مرورگر)
    this.processPush(
      userId,
      resolvedTitle ?? '',
      resolvedMessage ?? '',
      enrichedMeta,
    ).catch((err) => {
      this.logger.error('Failed to process push notification', err);
    });

    if (!siteEnabled && !smsFromRule && !smsFromOverride) {
      return { notification: null, dispatched: true };
    }

    let notification: Awaited<
      ReturnType<typeof this.prisma.notification.create>
    > | null = null;

    if (siteEnabled) {
      notification = await this.prisma.notification.create({
        data: {
          userId,
          type,
          title: resolvedTitle,
          message: resolvedMessage,
          meta: metaValue,
        },
      });
    }

    if (smsFromOverride && !smsFromRule) {
      this.processSmsOverride(userId, smsOverride!, enrichedMeta).catch(
        (err) => {
          this.logger.error('Failed to process SMS override', err);
        },
      );
    } else if (smsFromRule) {
      this.processSms(userId, type, enrichedMeta, rule).catch((err) => {
        this.logger.error('Failed to process SMS notification', err);
      });
    }

    return { notification, dispatched: true };
  }

  /** چند گیرنده — هر کدام از مسیر create (سایت + SMS + push) */
  async notifyMany(
    items: Array<{
      userId: string;
      type: NotificationType;
      title: string;
      message: string;
      meta?: Record<string, unknown>;
    }>,
  ): Promise<void> {
    if (!items.length) return;
    await Promise.all(items.map((item) => this.create(item)));
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
    const siteEnabled = !(rule && rule.siteNotificationEnabled === false);
    const smsEnabled = this.isSmsRuleActive(rule);

    if (!siteEnabled && !smsEnabled) {
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

    if (siteEnabled) {
      await this.prisma.notification.createMany({
        data: admins.map((a) => ({
          userId: a.id,
          type,
          title: resolvedTitle,
          message: resolvedMessage,
          meta: metaValue,
        })),
      });
      const adminMeta = {
        ...(meta ?? {}),
        title: resolvedTitle,
        message: resolvedMessage,
        url: '/admin/notifications',
      };
      await Promise.all(
        admins.map((a) =>
          this.processPush(
            a.id,
            resolvedTitle ?? '',
            resolvedMessage ?? '',
            adminMeta,
          ).catch((e) => {
            this.logger.warn(
              `Push admin notification failed for ${a.id}: ${String((e as Error)?.message ?? e)}`,
            );
          }),
        ),
      );
    }

    if (smsEnabled) {
      this.processSmsForGodadmins(type, meta).catch((err) => {
        this.logger.error('Failed to process admin SMS notification', err);
      });
    }
  }

  private isSmsRuleActive(rule: SmsRule | null): boolean {
    if (!rule || rule.smsEnabled !== true) return false;
    const templateId = Number(rule.smsTemplateConfig?.templateId);
    return Number.isFinite(templateId) && templateId > 0;
  }

  private async processSmsForGodadmins(
    type: NotificationType,
    meta?: Record<string, unknown>,
  ) {
    const rule = await this.getRuleForType(type);
    if (!this.isSmsRuleActive(rule)) return;

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

    const templateId = Number(rule!.smsTemplateConfig!.templateId);
    const configured = Array.isArray(rule!.smsTemplateConfig!.parameters)
      ? rule!.smsTemplateConfig!.parameters
      : [];

    for (const ga of godadmins) {
        if (!ga.phone) continue;
        const paramsWithRecipient = configured
          .map((p) => ({
            name: String(p?.name ?? '').trim(),
            value: applySmsTemplatePlaceholders(String(p?.value ?? ''), {
              firstName: templateFirstName,
              listingTitle,
              adminFirstName: ga.firstName,
              meta: metaForSms,
            }),
          }))
          .filter((p) => p.name && p.value);
        try {
          await this.smsService.sendByTemplate(
            ga.phone,
            templateId,
            paramsWithRecipient,
          );
          this.logger.log(`پیامک ${type} برای GODADMIN ${ga.phone} ارسال شد.`);
        } catch (error: unknown) {
          const err = error as {
            response?: { data?: unknown };
            message?: string;
          };
          this.logger.error(
            `خطا در ارسال پیامک ادمین به ${ga.phone}:`,
            err?.response?.data || err?.message,
          );
        }
      }
  }

  private async processSms(
    userId: string,
    type: NotificationType,
    meta?: Record<string, unknown>,
    rulePrefetched?: SmsRule | null,
  ) {
    const rule = rulePrefetched ?? (await this.getRuleForType(type));
    if (!this.isSmsRuleActive(rule)) {
      this.logger.debug(`SMS skipped for ${type}: rule disabled or no template`);
      return;
    }

    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { phone: true, firstName: true, lastName: true, notifySms: true },
    });

    if (!user?.phone) {
      this.logger.debug(`SMS skipped for ${type}: user ${userId} has no phone`);
      return;
    }

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

    const templateId = Number(rule!.smsTemplateConfig!.templateId);
    const configured = Array.isArray(rule!.smsTemplateConfig!.parameters)
      ? rule!.smsTemplateConfig!.parameters
      : [];
    const parameters = configured
      .map((p) => ({
        name: String(p?.name ?? '').trim(),
        value: applySmsTemplatePlaceholders(String(p?.value ?? ''), {
          firstName: user.firstName,
          lastName: user.lastName,
          listingTitle,
          title:
            meta && typeof meta['title'] === 'string' ? meta['title'] : undefined,
          message:
            meta && typeof meta['message'] === 'string'
              ? meta['message']
              : undefined,
          meta: meta as Record<string, unknown> | undefined,
        }),
      }))
      .filter((p) => p.name && p.value);

    if (!Number.isFinite(templateId) || templateId <= 0) return;
    if (parameters.length === 0) {
      this.logger.warn(
        `SMS skipped for ${type}: no template parameters after placeholder resolution`,
      );
      return;
    }
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

  private async processSmsOverride(
    userId: string,
    config: {
      templateId: number;
      parameters?: Array<{ name: string; value: string }>;
    },
    meta?: Record<string, unknown>,
  ) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { phone: true, firstName: true, lastName: true },
    });
    if (!user?.phone) return;

    const templateId = Number(config.templateId);
    if (!Number.isFinite(templateId) || templateId <= 0) return;

    const parameters = (config.parameters ?? [])
      .map((p) => ({
        name: String(p?.name ?? '').trim(),
        value: applySmsTemplatePlaceholders(String(p?.value ?? ''), {
          firstName: user.firstName,
          lastName: user.lastName,
          title:
            meta && typeof meta['title'] === 'string' ? meta['title'] : undefined,
          message:
            meta && typeof meta['message'] === 'string'
              ? meta['message']
              : undefined,
          meta,
        }),
      }))
      .filter((p) => p.name && p.value);

    if (parameters.length === 0) return;

    try {
      await this.smsService.sendByTemplate(user.phone, templateId, parameters);
      this.logger.log(`پیامک سفارشی برای شماره ${user.phone} ارسال شد.`);
    } catch (error: unknown) {
      const err = error as { response?: { data?: unknown }; message?: string };
      this.logger.error(
        `خطا در ارسال پیامک سفارشی به ${user.phone}:`,
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

    const rule = await this.getRuleForType(NotificationType.ADMIN_ANNOUNCEMENT);
    const smsFromRules = this.isSmsRuleActive(rule);
    const smsOverride =
      alsoSendSms &&
      smsTemplateConfig?.templateId &&
      !smsFromRules
        ? smsTemplateConfig
        : undefined;

    const meta = {
      title: title.trim(),
      message: message.trim(),
      url: '/dashboard/notifications',
    };

    const chunkSize = 40;
    for (let i = 0; i < recipients.length; i += chunkSize) {
      const chunk = recipients.slice(i, i + chunkSize);
      await Promise.all(
        chunk.map((r) =>
          this.create({
            userId: r.id,
            type: NotificationType.ADMIN_ANNOUNCEMENT,
            title,
            message,
            meta,
            smsOverride,
          }),
        ),
      );
    }

    return {
      created: recipients.length,
      smsViaNotificationRules: smsFromRules,
      smsViaBroadcastOverride: !!smsOverride,
    };
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
    const normalized = this.normalizePushSubscription(subscription);
    if (!normalized.endpoint || !normalized.keys.p256dh || !normalized.keys.auth) {
      this.logger.warn(`Invalid push subscription payload for user ${userId}`);
      return { ok: false as const, reason: 'invalid_subscription' };
    }
    this.logger.log(`Push subscription saved for user ${userId}`);
    await this.prisma.systemSetting.upsert({
      where: { key: `PUSH_SUB_${userId}` },
      update: {
        value: JSON.stringify(normalized),
        description: 'Web push subscription',
      },
      create: {
        key: `PUSH_SUB_${userId}`,
        value: JSON.stringify(normalized),
        description: 'Web push subscription',
      },
    });
    return { ok: true as const };
  }

  /** وضعیت push برای UI (تنظیمات / صفحه اطلاعیه‌ها). */
  async getPushStatus(userId: string) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { notifyPush: true },
    });
    const setting = await this.prisma.systemSetting.findUnique({
      where: { key: `PUSH_SUB_${userId}` },
      select: { value: true },
    });
    let hasSubscription = false;
    if (setting?.value) {
      try {
        const sub = JSON.parse(setting.value) as PushSubscriptionPayload;
        hasSubscription = !!sub?.endpoint && !!sub?.keys?.p256dh;
      } catch {
        hasSubscription = false;
      }
    }
    const vapidConfigured = isVapidConfigured();
    const notifyPush = user?.notifyPush ?? true;
    const hints: string[] = [];
    if (!vapidConfigured) {
      hints.push(
        'کلیدهای WEB_PUSH_VAPID_PUBLIC_KEY و WEB_PUSH_VAPID_PRIVATE_KEY روی سرور API تنظیم نشده یا نامعتبر است.',
      );
    }
    if (!hasSubscription) {
      hints.push(
        'اشتراک push برای این کاربر ثبت نشده — از تنظیمات یا صفحه اطلاعیه‌ها فعال کنید.',
      );
    }
    if (!notifyPush) {
      hints.push('اعلان push در حساب کاربر خاموش است.');
    }

    return {
      notifyPush,
      hasSubscription,
      vapidConfigured,
      ready: vapidConfigured && hasSubscription && notifyPush,
      hints,
    };
  }

  /** ارسال یک push تست برای کاربر جاری (تنظیمات / دیباگ). */
  async sendPushTest(userId: string): Promise<{
    sent: boolean;
    reason?: string;
    detail?: string;
  }> {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { notifyPush: true },
    });
    if (!user?.notifyPush) {
      return { sent: false, reason: 'notify_push_disabled' };
    }
    if (!isVapidConfigured()) {
      return { sent: false, reason: 'vapid_not_configured' };
    }
    const setting = await this.prisma.systemSetting.findUnique({
      where: { key: `PUSH_SUB_${userId}` },
      select: { value: true },
    });
    if (!setting?.value) {
      return { sent: false, reason: 'no_subscription' };
    }
    const result = await this.processPush(
      userId,
      'تست اعلان طبقه',
      'اگر این پیام را روی صفحهٔ قفل یا نوار اعلان می‌بینید، push درست کار می‌کند.',
      { url: '/dashboard/notifications' },
    );
    if (!result.ok) {
      return {
        sent: false,
        reason: result.reason ?? 'send_failed',
        detail: result.detail,
      };
    }
    return { sent: true };
  }

  private normalizePushSubscription(
    subscription: PushSubscriptionPayload,
  ): PushSubscriptionPayload {
    return {
      endpoint: subscription.endpoint,
      keys: {
        p256dh: this.toUrlBase64(subscription.keys?.p256dh ?? ''),
        auth: this.toUrlBase64(subscription.keys?.auth ?? ''),
      },
    };
  }

  /**
   * کلیدهای PushSubscription معمولاً از قبل base64url هستند — فقط اگر + یا / داشت تبدیل می‌شود.
   * حذف padding از کلیدهای url-safe باعث push_send_failed می‌شود.
   */
  private toUrlBase64(value: string): string {
    const trimmed = String(value ?? '').trim();
    if (!trimmed) return trimmed;
    if (!/[+/]/.test(trimmed)) {
      return trimmed;
    }
    const padded =
      trimmed + '='.repeat((4 - (trimmed.length % 4)) % 4);
    return Buffer.from(padded, 'base64')
      .toString('base64')
      .replace(/\+/g, '-')
      .replace(/\//g, '_')
      .replace(/=+$/, '');
  }

  async removePushSubscription(userId: string) {
    await this.prisma.systemSetting.deleteMany({
      where: { key: `PUSH_SUB_${userId}` },
    });
    return { ok: true };
  }

  private resolvePushUrl(meta?: Record<string, unknown>): string {
    if (meta && typeof meta['url'] === 'string') {
      const url = meta['url'].trim();
      if (url.startsWith('/')) return url;
    }
    if (meta && typeof meta['orderId'] === 'string') {
      return `/orders/${meta['orderId']}`;
    }
    if (meta && typeof meta['listingId'] === 'string') {
      return `/listing/${meta['listingId']}`;
    }
    return '/dashboard/notifications';
  }

  private async processPush(
    userId: string,
    title: string,
    message: string,
    meta?: Record<string, unknown>,
  ): Promise<{ ok: boolean; reason?: string; detail?: string }> {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { notifyPush: true },
    });
    if (!user?.notifyPush) return { ok: false, reason: 'notify_push_disabled' };

    const setting = await this.prisma.systemSetting.findUnique({
      where: { key: `PUSH_SUB_${userId}` },
      select: { value: true },
    });
    if (!setting?.value) return { ok: false, reason: 'no_subscription' };
    let subscription: PushSubscriptionPayload | null = null;
    try {
      subscription = JSON.parse(setting.value) as PushSubscriptionPayload;
    } catch {
      subscription = null;
    }
    if (!subscription?.endpoint) return { ok: false, reason: 'no_subscription' };
    subscription = this.normalizePushSubscription(subscription);

    const vapid = resolveVapidKeys();
    if (!vapid) {
      this.logger.error(
        `WebPush skipped for user ${userId}: invalid or missing WEB_PUSH_VAPID_* on API`,
      );
      return { ok: false, reason: 'vapid_not_configured' };
    }

    const url = this.resolvePushUrl(meta);
    const iconMeta = this.resolvePushIconMeta();
    return this.sendWebPush(
      userId,
      subscription,
      { title, message, url, icon: iconMeta.icon, iconRaster: iconMeta.iconRaster },
      vapid,
    );
  }

  private resolvePushIconMeta(): { icon: string; iconRaster: boolean } {
    const origin = getFrontendAppOrigin();
    return {
      icon: `${origin}/pwa/icon-512.png`,
      iconRaster: true,
    };
  }

  private async sendWebPush(
    userId: string,
    subscription: PushSubscriptionPayload,
    payload: {
      title: string;
      message: string;
      url: string;
      icon?: string;
      iconRaster: boolean;
    },
    vapid: { publicKey: string; privateKey: string; subject: string },
  ): Promise<{ ok: boolean; reason?: string; detail?: string }> {
    const icon = payload.icon?.trim() || undefined;
    const pushBody = JSON.stringify({
      title: payload.title,
      message: payload.message,
      url: payload.url,
      icon,
      iconRaster: payload.iconRaster,
      tag: 'tabaghe-notification',
      notification: {
        title: payload.title,
        body: payload.message,
        icon,
        badge: icon,
        tag: 'tabaghe-notification',
        renotify: true,
        dir: 'rtl',
        lang: 'fa',
        data: { url: payload.url },
      },
    });

    try {
      webpush.setVapidDetails(vapid.subject, vapid.publicKey, vapid.privateKey);
      await webpush.sendNotification(
        {
          endpoint: subscription.endpoint,
          keys: subscription.keys,
        },
        pushBody,
        { TTL: 86_400, urgency: 'high' as any },
      );
      this.logger.log(`WebPush sent to user ${userId}`);
      return { ok: true };
    } catch (err: any) {
      const status = Number(err?.statusCode ?? 0);
      if (status === 404 || status === 410) {
        await this.removePushSubscription(userId);
      }
      const reason = status ? `push_http_${status}` : 'push_send_failed';
      const body =
        err?.body != null
          ? String(err.body).slice(0, 240)
          : String(err?.message ?? err).slice(0, 240);
      this.logger.warn(
        `WebPush request failed (${status || 'n/a'}) user=${userId}: ${body}`,
      );
      return { ok: false, reason, detail: body || undefined };
    }
  }
}
