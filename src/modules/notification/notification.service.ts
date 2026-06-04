import { randomUUID } from 'crypto';
import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { NotificationType, Prisma, UserRole } from '@prisma/client';
import { SmsService } from '../sms/sms.service';
import { applySmsTemplatePlaceholders } from '../../common/sms/sms-placeholders.util';
import {
  buildNotificationRuleKey,
  enrichNotificationMeta,
  inferNotificationRecipientRole,
} from '../../common/notification/notification-meta-enrichment.util';
import { isUserOperationalSmsEnabled } from '../../common/notification/user-sms-notification.util';
import { resolveNotificationPath } from '../../common/notification/notification-navigation.util';
import webpush = require('web-push');
import { getFrontendAppOrigin } from '../../common/pwa-brand-icon.util';
import { isVapidConfigured, resolveVapidKeys, validateVapidKeyPair } from '../../common/push/vapid-keys.util';

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
    /** نقش گیرنده برای انتخاب قالب جدا (مثلاً BUYER / SELLER) */
    recipientRole?: string;
    /** فقط برای broadcast یک‌باره؛ در غیر این صورت از SMS_NOTIFICATION_RULES استفاده می‌شود */
    smsOverride?: {
      templateId: number;
      parameters?: Array<{ name: string; value: string }>;
    };
    /** اطلاعیهٔ دستی ادمین: همیشه در سایت ثبت شود حتی اگر نوتیف سایت در قوانین خاموش باشد */
    forceSiteNotification?: boolean;
  }) {
    const {
      userId,
      type,
      title,
      message,
      meta,
      smsOverride,
      recipientRole,
      forceSiteNotification,
    } = params;
    const enrichedMetaBase = await enrichNotificationMeta(this.prisma, meta);
    const resolvedRecipientRole =
      recipientRole ?? inferNotificationRecipientRole(enrichedMetaBase);
    const rule = await this.getRuleForType(type, resolvedRecipientRole);
    const siteEnabled =
      forceSiteNotification === true
        ? true
        : !(rule && rule.siteNotificationEnabled === false);
    const smsFromRule = this.isSmsRuleActive(rule);
    const smsFromOverride =
      !!smsOverride?.templateId && Number(smsOverride.templateId) > 0;

    const resolvedTitle = title?.trim();
    const resolvedMessage =
      forceSiteNotification === true
        ? message?.trim() || ''
        : rule?.siteNotificationText?.trim() || message;
    const navPath = resolveNotificationPath(String(type), enrichedMetaBase);
    const enrichedMeta: Record<string, unknown> = {
      ...enrichedMetaBase,
      title: resolvedTitle,
      message: resolvedMessage,
      ...(navPath ? { url: navPath } : {}),
    };
    const metaValue = meta === undefined ? undefined : (enrichedMeta as Prisma.InputJsonValue);

    if (!siteEnabled && !smsFromRule && !smsFromOverride) {
      this.processPush(
        userId,
        type,
        resolvedTitle ?? '',
        resolvedMessage ?? '',
        enrichedMeta,
      ).catch((err) => {
        this.logger.error('Failed to process push notification', err);
      });
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

    // Push بعد از ثبت سایت (برای tag یکتا) — کلیک در گوشی به لیست اطلاعیه‌ها می‌رود
    this.processPush(
      userId,
      type,
      resolvedTitle ?? '',
      resolvedMessage ?? '',
      enrichedMeta,
      notification?.id,
    ).catch((err) => {
      this.logger.error('Failed to process push notification', err);
    });

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
      };
      await Promise.all(
        admins.map((a) =>
          this.processPush(
            a.id,
            type,
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

    if (!isUserOperationalSmsEnabled(user.notifySms)) {
      this.logger.debug(
        `SMS skipped for ${type}: user ${userId} disabled SMS in settings`,
      );
      return;
    }

    // دریافت عنوان آگهی برای شخصی‌سازی پیامک
    let listingTitle = 'یک آگهی';
    if (
      meta &&
      typeof meta['listingTitle'] === 'string' &&
      meta['listingTitle'].trim()
    ) {
      listingTitle = meta['listingTitle'];
    } else {
      const listingId =
        meta && typeof meta.listingId === 'string' ? meta.listingId : undefined;
      if (listingId) {
        const listing = await this.prisma.listing.findUnique({
          where: { id: listingId },
          select: { title: true },
        });
        if (listing) listingTitle = listing.title;
      }
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
          buyerName:
            meta && typeof meta['buyerName'] === 'string'
              ? meta['buyerName']
              : undefined,
          sellerName:
            meta && typeof meta['sellerName'] === 'string'
              ? meta['sellerName']
              : undefined,
          buyerPhone:
            meta && typeof meta['buyerPhone'] === 'string'
              ? meta['buyerPhone']
              : undefined,
          sellerPhone:
            meta && typeof meta['sellerPhone'] === 'string'
              ? meta['sellerPhone']
              : undefined,
          amountFormatted:
            meta && typeof meta['amountFormatted'] === 'string'
              ? meta['amountFormatted']
              : undefined,
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
      select: { phone: true, firstName: true, lastName: true, notifySms: true },
    });
    if (!user?.phone) return;

    if (!isUserOperationalSmsEnabled(user.notifySms)) {
      this.logger.debug(
        `SMS override skipped: user ${userId} disabled SMS in settings`,
      );
      return;
    }

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
    linkUrl?: string;
    alsoSendSms?: boolean;
    smsTemplateConfig?: {
      templateId: number;
      parameters?: Array<{ name: string; value: string }>;
    };
  }) {
    const { title, message, userIds, linkUrl, alsoSendSms, smsTemplateConfig } =
      params;
    let recipients: { id: string }[];
    if (userIds === undefined) {
      recipients = await this.prisma.user.findMany({ select: { id: true } });
    } else if (userIds.length === 0) {
      return { created: 0 };
    } else {
      recipients = await this.prisma.user.findMany({
        where: { id: { in: userIds } },
        select: { id: true },
      });
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

    const normalizedLink = this.normalizeBroadcastLinkUrl(linkUrl);
    const trimmedTitle = title.trim();
    const trimmedMessage = message.trim();
    const meta: Record<string, unknown> = {
      title: trimmedTitle,
      message: trimmedMessage,
      ...(normalizedLink ? { url: normalizedLink } : {}),
    };
    const metaJson = meta as Prisma.InputJsonValue;

    // اطلاعیهٔ ادمین: همیشه مستقیم در DB (مستقل از خاموش بودن «نوتیف سایت» در قوانین)
    const chunkSize = 100;
    for (let i = 0; i < recipients.length; i += chunkSize) {
      const chunk = recipients.slice(i, i + chunkSize);
      await this.prisma.notification.createMany({
        data: chunk.map((r) => ({
          userId: r.id,
          type: NotificationType.ADMIN_ANNOUNCEMENT,
          title: trimmedTitle,
          message: trimmedMessage,
          meta: metaJson,
        })),
      });
    }

    // پیامک و push جداگانه (بدون ثبت دوبارهٔ رکورد سایت)
    for (let i = 0; i < recipients.length; i += chunkSize) {
      const chunk = recipients.slice(i, i + chunkSize);
      await Promise.all(
        chunk.map((r) =>
          this.dispatchAdminAnnouncementChannels(
            r.id,
            trimmedTitle,
            trimmedMessage,
            meta,
            rule,
            smsFromRules,
            smsOverride,
          ),
        ),
      );
    }

    return {
      created: recipients.length,
      siteNotificationsCreated: recipients.length,
      smsViaNotificationRules: smsFromRules,
      smsViaBroadcastOverride: !!smsOverride,
    };
  }

  /** پس از createMany اطلاعیهٔ ادمین — فقط SMS و push */
  private async dispatchAdminAnnouncementChannels(
    userId: string,
    title: string,
    message: string,
    meta: Record<string, unknown>,
    rule: SmsRule | null,
    smsFromRules: boolean,
    smsOverride?: {
      templateId: number;
      parameters?: Array<{ name: string; value: string }>;
    },
  ): Promise<void> {
    const pushMeta = { ...meta, title, message };
    this.processPush(
      userId,
      NotificationType.ADMIN_ANNOUNCEMENT,
      title,
      message,
      pushMeta,
    ).catch((err) => {
      this.logger.error('Failed to process push for admin announcement', err);
    });

    if (smsOverride?.templateId && !smsFromRules) {
      this.processSmsOverride(userId, smsOverride, pushMeta).catch((err) => {
        this.logger.error('Failed to process SMS override for admin announcement', err);
      });
    } else if (smsFromRules && rule) {
      this.processSms(
        userId,
        NotificationType.ADMIN_ANNOUNCEMENT,
        pushMeta,
        rule,
      ).catch((err) => {
        this.logger.error('Failed to process SMS for admin announcement', err);
      });
    }
  }

  private normalizeBroadcastLinkUrl(raw?: string): string | undefined {
    const trimmed = raw?.trim();
    if (!trimmed) return undefined;
    if (trimmed.startsWith('/admin/')) {
      throw new BadRequestException('لینک اطلاعیه نمی‌تواند به پنل ادمین اشاره کند');
    }
    if (trimmed.startsWith('/')) return trimmed;
    if (/^https?:\/\//i.test(trimmed)) return trimmed;
    throw new BadRequestException('لینک باید با / یا http(s):// شروع شود');
  }

  private async getRuleForType(
    type: NotificationType,
    recipientRole?: string,
  ): Promise<SmsRule | null> {
    try {
      const row = await this.prisma.systemSetting.findUnique({
        where: { key: 'SMS_NOTIFICATION_RULES' },
        select: { value: true },
      });
      if (!row?.value) return null;
      const parsed = JSON.parse(row.value) as Record<string, SmsRule>;
      const roleKey = buildNotificationRuleKey(String(type), recipientRole);
      const rule = parsed?.[roleKey] ?? parsed?.[String(type)];
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
    const vapidPair = validateVapidKeyPair();
    const hints: string[] = [];
    if (!vapidConfigured) {
      hints.push(
        'کلیدهای WEB_PUSH_VAPID_PUBLIC_KEY و WEB_PUSH_VAPID_PRIVATE_KEY روی سرور API تنظیم نشده یا نامعتبر است.',
      );
    } else if (!vapidPair.ok) {
      hints.push(
        'کلید public و private VAPID با هم جور نیستند — با npx web-push generate-vapid-keys جفت جدید بسازید و در .env و فرانت یکجا بگذارید.',
      );
      if (vapidPair.publicKey) {
        hints.push(`publicKey درست (از private): ${vapidPair.publicKey}`);
      }
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
      vapidPairValid: vapidPair.ok,
      ready: vapidConfigured && vapidPair.ok && hasSubscription && notifyPush,
      hints,
    };
  }

  private normalizePushSubscription(
    subscription: PushSubscriptionPayload,
  ): PushSubscriptionPayload {
    const p256dh = String(subscription.keys?.p256dh ?? '').trim();
    const auth = String(subscription.keys?.auth ?? '').trim();
    return {
      endpoint: String(subscription.endpoint ?? '').trim(),
      keys: {
        p256dh: /[+/]/.test(p256dh) ? this.toUrlBase64(p256dh) : p256dh,
        auth: /[+/]/.test(auth) ? this.toUrlBase64(auth) : auth,
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

  private async processPush(
    userId: string,
    type: NotificationType,
    title: string,
    message: string,
    meta?: Record<string, unknown>,
    notificationId?: string,
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

    const iconMeta = this.resolvePushIconMeta();
    const pushNotificationId = notificationId?.trim() || randomUUID();
    return this.sendWebPush(
      userId,
      subscription,
      {
        title,
        message,
        notificationId: pushNotificationId,
        icon: iconMeta.icon,
        iconRaster: iconMeta.iconRaster,
      },
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
      notificationId: string;
      icon?: string;
      iconRaster: boolean;
    },
    vapid: { publicKey: string; privateKey: string; subject: string },
  ): Promise<{ ok: boolean; reason?: string; detail?: string }> {
    const icon = payload.icon?.trim() || undefined;
    const notificationId = payload.notificationId.trim() || randomUUID();
    const inboxPath = '/dashboard/notifications';
    // فقط data — بدون فیلد notification تا مرورگر/FCM خودکار دوبار نشان ندهد
    const pushBody = JSON.stringify({
      title: payload.title,
      message: payload.message,
      url: inboxPath,
      notificationId,
      navigate: true,
      icon,
      iconRaster: payload.iconRaster,
      tag: `tabaghe-${notificationId}`,
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
      const message = String(err?.message ?? err ?? '');
      if (status === 404 || status === 410) {
        await this.removePushSubscription(userId);
      }
      if (
        !status &&
        (/p256dh|auth.*bytes|subscription keys/i.test(message) ||
          message.includes('Invalid'))
      ) {
        await this.removePushSubscription(userId);
      }
      const reason = status ? `push_http_${status}` : 'push_send_failed';
      const body =
        err?.body != null
          ? String(err.body).slice(0, 240)
          : message.slice(0, 240);
      this.logger.warn(
        `WebPush request failed (${status || 'n/a'}) user=${userId}: ${body}`,
      );
      return { ok: false, reason, detail: body || undefined };
    }
  }
}
