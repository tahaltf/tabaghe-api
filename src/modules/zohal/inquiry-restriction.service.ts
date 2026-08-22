import {
  BadRequestException,
  HttpException,
  HttpStatus,
  Injectable,
} from '@nestjs/common';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';

export type InquiryCategory = 'identity' | 'financial' | 'postal';

export type InquiryRestrictionSnapshot = {
  inquiryBlocked: boolean;
  manualEntryOnly: boolean;
  identityPayloadAttempts: number;
  identityFailureCount: number;
  financialPayloadAttempts: number;
  financialFailureCount: number;
  maxInquiriesPerMinute: number | null;
  maxInquiriesPerDay: number | null;
  maxBankAccounts: number | null;
  limits: { minute: number; day: number };
  usage: { minute: number; day: number };
  bankAccounts: { activeCount: number; limit: number };
  maxPayloadChanges: number;
  maxFailuresBeforeManual: number;
  manualEntryEnabled: boolean;
};

const INQUIRY_SETTING_KEYS = {
  MAX_PER_MINUTE: 'INQUIRY_MAX_PER_MINUTE',
  MAX_PER_DAY: 'INQUIRY_MAX_PER_DAY',
  MAX_PAYLOAD_CHANGES: 'INQUIRY_MAX_PAYLOAD_CHANGES',
  MAX_FAILURES_BEFORE_MANUAL: 'INQUIRY_MAX_FAILURES_BEFORE_MANUAL',
  KYC_MANUAL_ENTRY_ENABLED: 'KYC_MANUAL_ENTRY_ENABLED',
  MAX_BANK_ACCOUNTS: 'MAX_BANK_ACCOUNTS',
} as const;

const INQUIRY_SETTING_DEFAULTS: Record<string, string> = {
  [INQUIRY_SETTING_KEYS.MAX_PER_MINUTE]: '5',
  [INQUIRY_SETTING_KEYS.MAX_PER_DAY]: '30',
  [INQUIRY_SETTING_KEYS.MAX_PAYLOAD_CHANGES]: '3',
  [INQUIRY_SETTING_KEYS.MAX_FAILURES_BEFORE_MANUAL]: '3',
  [INQUIRY_SETTING_KEYS.KYC_MANUAL_ENTRY_ENABLED]: 'true',
  [INQUIRY_SETTING_KEYS.MAX_BANK_ACCOUNTS]: '3',
};

@Injectable()
export class InquiryRestrictionService {
  constructor(private readonly prisma: PrismaService) {}

  async getSnapshot(userId: string): Promise<InquiryRestrictionSnapshot> {
    const [row, settings, usage, activeBankAccounts] = await Promise.all([
      this.ensureRow(userId),
      this.loadSettings(),
      this.countUsage(userId),
      this.prisma.userBankAccount.count({
        where: { userId, deletedAt: null },
      }),
    ]);
    const bankAccountLimit = row.maxBankAccounts ?? settings.maxBankAccounts;
    return {
      inquiryBlocked: row.inquiryBlocked,
      manualEntryOnly: row.manualEntryOnly,
      identityPayloadAttempts: row.identityPayloadAttempts,
      identityFailureCount: row.identityFailureCount,
      financialPayloadAttempts: row.financialPayloadAttempts,
      financialFailureCount: row.financialFailureCount,
      maxInquiriesPerMinute: row.maxInquiriesPerMinute,
      maxInquiriesPerDay: row.maxInquiriesPerDay,
      maxBankAccounts: row.maxBankAccounts,
      limits: {
        minute: row.maxInquiriesPerMinute ?? settings.maxPerMinute,
        day: row.maxInquiriesPerDay ?? settings.maxPerDay,
      },
      usage,
      bankAccounts: { activeCount: activeBankAccounts, limit: bankAccountLimit },
      maxPayloadChanges: settings.maxPayloadChanges,
      maxFailuresBeforeManual: settings.maxFailuresBeforeManual,
      manualEntryEnabled: settings.manualEntryEnabled,
    };
  }

  async getBankAccountLimit(userId: string): Promise<number> {
    const [row, settings] = await Promise.all([
      this.ensureRow(userId),
      this.loadSettings(),
    ]);
    return row.maxBankAccounts ?? settings.maxBankAccounts;
  }

  async assertCanAddBankAccount(userId: string): Promise<void> {
    const [activeCount, limit] = await Promise.all([
      this.prisma.userBankAccount.count({ where: { userId, deletedAt: null } }),
      this.getBankAccountLimit(userId),
    ]);
    if (activeCount >= limit) {
      throw new BadRequestException(
        `حداکثر ${limit} حساب بانکی می‌توانید ثبت کنید. برای افزودن حساب جدید، ابتدا یکی از حساب‌های فعلی را حذف کنید.`,
      );
    }
  }

  async assertCanInquire(userId: string, category: InquiryCategory): Promise<void> {
    const row = await this.ensureRow(userId);
    if (row.inquiryBlocked) {
      throw new BadRequestException(
        row.blockedReason?.trim() ||
          'دسترسی استعلام شما محدود شده است. لطفاً با پشتیبانی تماس بگیرید.',
      );
    }
    if (row.manualEntryOnly && category !== 'postal') {
      throw new BadRequestException(
        'امکان استعلام خودکار برای حساب شما غیرفعال است. اطلاعات را به‌صورت دستی وارد کنید.',
      );
    }
  }

  /** Call after cache miss, before external API call */
  async assertRateLimit(userId: string): Promise<void> {
    const [row, settings] = await Promise.all([
      this.ensureRow(userId),
      this.loadSettings(),
    ]);
    const limitMinute = row.maxInquiriesPerMinute ?? settings.maxPerMinute;
    const limitDay = row.maxInquiriesPerDay ?? settings.maxPerDay;
    const usage = await this.countUsage(userId);

    if (usage.minute >= limitMinute) {
      throw new HttpException(
        'تعداد درخواست استعلام شما در این دقیقه بیش از حد مجاز است. لطفاً کمی بعد دوباره تلاش کنید.',
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }
    if (usage.day >= limitDay) {
      throw new HttpException(
        'تعداد درخواست استعلام مجاز امروز را استفاده کرده‌اید. فردا دوباره تلاش کنید.',
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }
  }

  async recordNewPayload(userId: string, category: InquiryCategory): Promise<void> {
    const settings = await this.loadSettings();
    const row = await this.ensureRow(userId);
    const field =
      category === 'financial'
        ? 'financialPayloadAttempts'
        : 'identityPayloadAttempts';
    const next = (row[field] as number) + 1;
    const blocked = next >= settings.maxPayloadChanges;
    await this.prisma.userInquiryRestriction.update({
      where: { userId },
      data: {
        [field]: next,
        ...(blocked
          ? {
              inquiryBlocked: true,
              blockedAt: new Date(),
              blockedReason:
                'تعداد تغییرات اطلاعات استعلام بیش از حد مجاز بوده است.',
            }
          : {}),
      },
    });
  }

  async recordFailure(userId: string, category: InquiryCategory): Promise<void> {
    const settings = await this.loadSettings();
    if (!settings.manualEntryEnabled) return;
    const row = await this.ensureRow(userId);
    const field =
      category === 'financial'
        ? 'financialFailureCount'
        : 'identityFailureCount';
    const next = (row[field] as number) + 1;
    await this.prisma.userInquiryRestriction.update({
      where: { userId },
      data: {
        [field]: next,
        ...(next >= settings.maxFailuresBeforeManual
          ? { manualEntryOnly: true }
          : {}),
      },
    });
  }

  async recordSuccess(userId: string, category: InquiryCategory): Promise<void> {
    const field =
      category === 'financial'
        ? 'financialFailureCount'
        : 'identityFailureCount';
    await this.prisma.userInquiryRestriction.updateMany({
      where: { userId },
      data: { [field]: 0 },
    });
  }

  async adminUpdate(
    userId: string,
    data: {
      inquiryBlocked?: boolean;
      manualEntryOnly?: boolean;
      maxInquiriesPerMinute?: number | null;
      maxInquiriesPerDay?: number | null;
      maxBankAccounts?: number | null;
      resetCounters?: boolean;
      unblock?: boolean;
    },
    adminId?: string,
  ) {
    await this.ensureRow(userId);
    const patch: Record<string, unknown> = { updatedAt: new Date() };
    if (data.inquiryBlocked !== undefined) {
      patch.inquiryBlocked = data.inquiryBlocked;
      if (data.inquiryBlocked) {
        patch.blockedAt = new Date();
      }
    }
    if (data.manualEntryOnly !== undefined) {
      patch.manualEntryOnly = data.manualEntryOnly;
    }
    if (data.maxInquiriesPerMinute !== undefined) {
      patch.maxInquiriesPerMinute = data.maxInquiriesPerMinute;
    }
    if (data.maxInquiriesPerDay !== undefined) {
      patch.maxInquiriesPerDay = data.maxInquiriesPerDay;
    }
    if (data.maxBankAccounts !== undefined) {
      patch.maxBankAccounts = data.maxBankAccounts;
    }
    if (data.resetCounters) {
      patch.identityPayloadAttempts = 0;
      patch.identityFailureCount = 0;
      patch.financialPayloadAttempts = 0;
      patch.financialFailureCount = 0;
    }
    if (data.unblock) {
      patch.inquiryBlocked = false;
      patch.manualEntryOnly = false;
      patch.blockedReason = null;
      patch.blockedAt = null;
      patch.unblockedByAdminId = adminId ?? null;
      patch.identityPayloadAttempts = 0;
      patch.identityFailureCount = 0;
      patch.financialPayloadAttempts = 0;
      patch.financialFailureCount = 0;
    }
    await this.prisma.userInquiryRestriction.update({
      where: { userId },
      data: patch as never,
    });
    return this.getSnapshot(userId);
  }

  async listBlockedUsers(skip = 0, take = 50) {
    const [items, total] = await Promise.all([
      this.prisma.userInquiryRestriction.findMany({
        where: {
          OR: [{ inquiryBlocked: true }, { manualEntryOnly: true }],
        },
        include: {
          user: {
            select: {
              id: true,
              phone: true,
              firstName: true,
              lastName: true,
            },
          },
        },
        orderBy: { updatedAt: 'desc' },
        skip,
        take,
      }),
      this.prisma.userInquiryRestriction.count({
        where: {
          OR: [{ inquiryBlocked: true }, { manualEntryOnly: true }],
        },
      }),
    ]);
    return { items, total };
  }

  private async ensureRow(userId: string) {
    return this.prisma.userInquiryRestriction.upsert({
      where: { userId },
      create: { userId, updatedAt: new Date() },
      update: {},
    });
  }

  private async countUsage(userId: string) {
    const minuteAgo = new Date(Date.now() - 60_000);
    const dayAgo = new Date(Date.now() - 86_400_000);
    const [minute, day] = await Promise.all([
      this.prisma.zohalInquiryLog.count({
        where: { userId, createdAt: { gte: minuteAgo } },
      }),
      this.prisma.zohalInquiryLog.count({
        where: { userId, createdAt: { gte: dayAgo } },
      }),
    ]);
    return { minute, day };
  }

  private async loadSettings() {
    const keys = Object.values(INQUIRY_SETTING_KEYS);
    const rows = await this.prisma.systemSetting.findMany({
      where: { key: { in: keys } },
      select: { key: true, value: true },
    });
    const raw: Record<string, string> = { ...INQUIRY_SETTING_DEFAULTS };
    for (const row of rows) raw[row.key] = row.value;
    return {
      maxPerMinute: parseInt(raw[INQUIRY_SETTING_KEYS.MAX_PER_MINUTE] ?? '5', 10) || 5,
      maxPerDay: parseInt(raw[INQUIRY_SETTING_KEYS.MAX_PER_DAY] ?? '30', 10) || 30,
      maxPayloadChanges:
        parseInt(raw[INQUIRY_SETTING_KEYS.MAX_PAYLOAD_CHANGES] ?? '3', 10) || 3,
      maxFailuresBeforeManual:
        parseInt(raw[INQUIRY_SETTING_KEYS.MAX_FAILURES_BEFORE_MANUAL] ?? '3', 10) || 3,
      manualEntryEnabled:
        String(raw[INQUIRY_SETTING_KEYS.KYC_MANUAL_ENTRY_ENABLED] ?? 'true').toLowerCase() !==
        'false',
      maxBankAccounts:
        parseInt(raw[INQUIRY_SETTING_KEYS.MAX_BANK_ACCOUNTS] ?? '3', 10) || 3,
    };
  }
}

export { INQUIRY_SETTING_KEYS, INQUIRY_SETTING_DEFAULTS };
