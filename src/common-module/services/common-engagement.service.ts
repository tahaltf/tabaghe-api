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
      throw new BadRequestException('لطفاً شماره موبایل را وارد کنید');
    }

    const phone = this.normalizeIranMobile(contact);
    if (!phone) {
      throw new BadRequestException(
        'شماره موبایل باید ۱۱ رقم و با ۰۹ شروع شود (مثال: ۰۹۱۲۳۴۵۶۷۸۹)',
      );
    }

    const key = `CUSTOMER_CLUB_PHONE_${phone}`;

    const existing = await this.prisma.systemSetting.findUnique({
      where: { key },
      select: { key: true },
    });
    if (existing) {
      throw new ConflictException('این شماره موبایل قبلاً در باشگاه مشتریان ثبت شده است');
    }

    await this.prisma.systemSetting.create({
      data: {
        key,
        value: JSON.stringify({
          phone,
          email: null,
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

  parseContactsFromText(raw: string): string[] {
    return String(raw ?? '')
      .split(/[\r\n,;\t]+/)
      .map((line) => {
        const trimmed = line.trim();
        if (!trimmed) return '';
        if (trimmed.includes(',')) {
          return trimmed.split(',')[0]?.trim() ?? '';
        }
        return trimmed;
      })
      .filter(Boolean);
  }

  async addCustomerClubContact(
    rawContact: string,
  ): Promise<'added' | 'duplicate' | 'invalid'> {
    const contact = String(rawContact ?? '').trim();
    if (!contact) return 'invalid';

    const phone = this.normalizeIranMobile(contact);
    if (!phone) return 'invalid';

    const key = `CUSTOMER_CLUB_PHONE_${phone}`;

    const existing = await this.prisma.systemSetting.findUnique({
      where: { key },
      select: { key: true },
    });
    if (existing) return 'duplicate';

    await this.prisma.systemSetting.create({
      data: {
        key,
        value: JSON.stringify({
          phone,
          email: null,
          createdAt: new Date().toISOString(),
        }),
        description: 'Customer club subscription',
      },
    });

    return 'added';
  }

  async importCustomerClubContacts(rawContacts: string[]): Promise<{
    added: number;
    skippedDuplicate: number;
    invalid: string[];
  }> {
    const unique = new Set<string>();
    const invalid: string[] = [];
    let added = 0;
    let skippedDuplicate = 0;

    for (const raw of rawContacts) {
      const contact = String(raw ?? '').trim();
      if (!contact) continue;
      const dedupeKey = contact.toLowerCase();
      if (unique.has(dedupeKey)) {
        skippedDuplicate += 1;
        continue;
      }
      unique.add(dedupeKey);

      const result = await this.addCustomerClubContact(contact);
      if (result === 'added') added += 1;
      else if (result === 'duplicate') skippedDuplicate += 1;
      else invalid.push(contact);
    }

    return { added, skippedDuplicate, invalid };
  }

}
