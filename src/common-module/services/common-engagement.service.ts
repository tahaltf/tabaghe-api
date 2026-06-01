import {
  BadRequestException,
  ConflictException,
  Injectable,
} from '@nestjs/common';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';

import { NotificationType } from '@prisma/client';
import { NotificationService } from '../../modules/notification/notification.service';

@Injectable()
export class CommonEngagementService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly notifications: NotificationService,
  ) {}

  toLatinDigits(text: string): string {
    const persian = '۰۱۲۳۴۵۶۷۸۹';
    const arabic = '٠١٢٣٤٥٦٧٨٩';
    return text.replace(/[۰-۹٠-٩]/g, (ch) => {
      const pi = persian.indexOf(ch);
      if (pi >= 0) return String(pi);
      const ai = arabic.indexOf(ch);
      return ai >= 0 ? String(ai) : ch;
    });
  }

  normalizeIranMobile(input: string): string | null {
    let digits = this.toLatinDigits(String(input ?? '').trim()).replace(/\D/g, '');
    if (digits.startsWith('98') && digits.length === 12) {
      digits = `0${digits.slice(2)}`;
    }
    if (digits.startsWith('9') && digits.length === 10) {
      digits = `0${digits}`;
    }
    if (!/^09\d{9}$/.test(digits)) return null;
    return digits;
  }

  async subscribeCustomerClub(rawContact: string) {
    const contact = String(rawContact ?? '').trim();
    if (!contact) {
      throw new BadRequestException('لطفاً ایمیل یا شماره موبایل را وارد کنید');
    }

    const emailRe = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    const phone = this.normalizeIranMobile(contact);
    const email = !phone && emailRe.test(contact) ? contact.toLowerCase() : null;

    if (!phone && !email) {
      if (/@/.test(contact) || /[a-zA-Z]/.test(contact)) {
        throw new BadRequestException('فرمت ایمیل صحیح نیست');
      }
      throw new BadRequestException(
        'شماره موبایل باید ۱۱ رقم و با ۰۹ شروع شود (مثال: ۰۹۱۲۳۴۵۶۷۸۹)',
      );
    }

    const key = phone
      ? `CUSTOMER_CLUB_PHONE_${phone}`
      : `CUSTOMER_CLUB_EMAIL_${email}`;

    const existing = await this.prisma.systemSetting.findUnique({
      where: { key },
      select: { key: true },
    });
    if (existing) {
      throw new ConflictException(
        phone
          ? 'این شماره موبایل قبلاً در کلوپ مشتریان ثبت شده است'
          : 'این ایمیل قبلاً در کلوپ مشتریان ثبت شده است',
      );
    }

    await this.prisma.systemSetting.create({
      data: {
        key,
        value: JSON.stringify({
          phone: phone ?? null,
          email: email ?? null,
          createdAt: new Date().toISOString(),
        }),
        description: 'Customer club subscription',
      },
    });

    return { ok: true };
  }

  async submitContactMessage(payload: {
    name: string;
    phone: string;
    email?: string;
    subject: string;
    message: string;
  }) {
    const key = `CONTACT_MESSAGE_${Date.now()}_${Math.floor(Math.random() * 10000)}`;
    const value = JSON.stringify({
      ...payload,
      createdAt: new Date().toISOString(),
    });
    await this.prisma.systemSetting.create({
      data: {
        key,
        value,
        description: 'Public contact form submission',
      },
    });
    void this.notifications
      .notifyAdminPersonnel({
        type: NotificationType.ADMIN_ALERT_CONTACT_MESSAGE,
        title: 'پیام تماس با ما',
        message: `${payload.name} — ${payload.subject}`,
        meta: {
          contactKey: key,
          name: payload.name,
          phone: payload.phone,
          email: payload.email ?? '',
          subject: payload.subject,
        },
      })
      .catch(() => undefined);
    return { ok: true };
  }

}
