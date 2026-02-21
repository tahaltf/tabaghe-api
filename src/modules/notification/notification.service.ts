import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { NotificationType } from '@prisma/client';
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
        meta?: Record<string, any>;
    }) {
        const { userId, type, title, message, meta } = params;

        // ۱. ثبت نوتیفیکیشن در دیتابیس (برای نمایش در پنل کاربری)
        const notification = await this.prisma.notification.create({
            data: { userId, type, title, message, meta },
        });

        // ۲. ارسال پیامک به صورت پس‌زمینه (آسنکرون)
        this.processSms(userId, type, meta).catch(err => {
            this.logger.error('Failed to process SMS notification', err);
        });

        return notification;
    }

    private async processSms(userId: string, type: NotificationType, meta?: Record<string, any>) {
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
        if (meta && meta.listingId) {
            const listing = await this.prisma.listing.findUnique({
                where: { id: meta.listingId },
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
        } catch (error: any) {
            this.logger.error(`خطا در ارسال پیامک به ${user.phone}:`, error?.response?.data || error.message);
        }
    }
}