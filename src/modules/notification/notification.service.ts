import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { NotificationType, Prisma } from '@prisma/client';
import { ConfigService } from '@nestjs/config';
import axios from 'axios';

@Injectable()
export class NotificationService {
    private readonly logger = new Logger(NotificationService.name);

    constructor(
      private readonly prisma: PrismaService,
      private readonly configService: ConfigService,
    ) {}

    async create(params: {
        userId: string;
        type: NotificationType;
        title: string;
        message: string;
        meta?: Record<string, unknown>;
    }) {
        const { userId, type, title, message, meta } = params;
        const metaValue =
          meta === undefined ? undefined : (meta as Prisma.InputJsonValue);

        // ۱. ثبت نوتیفیکیشن در دیتابیس (برای نمایش در پنل کاربری)
        const notification = await this.prisma.notification.create({
            data: { userId, type, title, message, meta: metaValue },
        });

        // ۲. ارسال پیامک به صورت پس‌زمینه (آسنکرون)
        this.processSms(userId, type, meta).catch(err => {
            this.logger.error('Failed to process SMS notification', err);
        });

        return notification;
    }

    private async processSms(userId: string, type: NotificationType, meta?: Record<string, unknown>) {
        const apiKey = this.configService.get<string>('SMS_IR_API_KEY');
        if (!apiKey) {
            this.logger.warn('SMS_IR_API_KEY تنظیم نشده است.');
            return;
        }

        // دریافت شماره موبایل کاربر
        const user = await this.prisma.user.findUnique({
            where: { id: userId },
            select: { phone: true, firstName: true }
        });

        if (!user || !user.phone) return;

        // دریافت عنوان آگهی برای شخصی‌سازی پیامک
        let listingTitle = 'یک آگهی';
        const listingId =
          meta && typeof meta.listingId === 'string' ? meta.listingId : undefined;
        if (listingId) {
            const listing = await this.prisma.listing.findUnique({
                where: { id: listingId },
                select: { title: true }
            });
            if (listing) listingTitle = listing.title;
        }

        // تعیین Template ID و متغیرهای پیامک بر اساس نوع رویداد
        // ⚠️ مهم: این Template ID ها رو باید در پنل sms.ir بسازی و اینجا جایگزین کنی
        let templateId: number;
        let parameters: { name: string; value: string }[] = [];

        switch (type) {
            case NotificationType.AUCTION_WON:
                // مثال الگو در sms.ir: کاربر گرامی، شما در مزایده کالا {ITEM} برنده شدید. جهت پرداخت به پلتفرم طبقه مراجعه کنید.
                templateId = 100001; // عدد واقعی قالب را از sms.ir اینجا بگذار
                parameters = [{ name: 'ITEM', value: listingTitle }];
                break;
            case NotificationType.AUCTION_LOST:
                // مثال الگو: کاربر گرامی، پیشنهاد شما در مزایده {ITEM} بالاتر زده شد.
                templateId = 100002;
                parameters = [{ name: 'ITEM', value: listingTitle }];
                break;
            case NotificationType.AUCTION_PENALIZED:
                // مثال الگو: کسر جریمه بابت عدم پرداخت مزایده {ITEM} در طبقه.
                templateId = 100003;
                parameters = [{ name: 'ITEM', value: listingTitle }];
                break;
            default:
                return; // برای تایپ‌های دیگر پیامک نمی‌دهیم
        }

        try {
            await axios.post(
              'https://api.sms.ir/v1/send/verify',
              {
                  mobile: user.phone,
                  templateId,
                  parameters,
              },
              {
                  headers: { 'X-API-KEY': apiKey },
              },
            );
            this.logger.log(`پیامک ${type} برای شماره ${user.phone} ارسال شد.`);
        } catch (error: unknown) {
            const err = error as { response?: { data?: unknown }; message?: string };
            this.logger.error(`خطا در ارسال پیامک به ${user.phone}:`, err?.response?.data || err?.message);
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
    }) {
      const { title, message, userIds } = params;
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
      return { created: recipients.length };
    }

    async markAsRead(userId: string, id: string) {
      const notification = await this.prisma.notification.findUnique({ where: { id } });
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
}