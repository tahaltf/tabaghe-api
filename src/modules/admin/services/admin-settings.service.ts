import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { existsSync, unlink } from 'fs';
import { join } from 'path';
import { PrismaService } from '../../../infrastructure/prisma/prisma.service';
import { BulkUpsertSettingsDto, UpsertSettingDto } from '../dto/admin-setting.dto';
import { BANNER_UPLOAD_PATH } from '../../../common/upload/banner-upload.config';

export const SETTING_KEYS = {
  HOMEPAGE_BANNER: 'HOMEPAGE_BANNER',
  VERIFICATION_FEE: 'VERIFICATION_FEE',
  SHIPPING_COST: 'SHIPPING_COST',
  PLATFORM_ADDRESS: 'PLATFORM_ADDRESS',
  SUPPORT_PHONE: 'SUPPORT_PHONE',
  SUPPORT_EMAIL: 'SUPPORT_EMAIL',
  BANK_CARD_NUMBER: 'BANK_CARD_NUMBER',
  BANK_ACCOUNT_HOLDER: 'BANK_ACCOUNT_HOLDER',
  BANK_SHABA: 'BANK_SHABA',
  TERMS_CONDITIONS: 'TERMS_CONDITIONS',
  ABOUT_US: 'ABOUT_US',
  REPAIR_ALLOWED_CATEGORY_IDS: 'REPAIR_ALLOWED_CATEGORY_IDS',
  PLATFORM_LATITUDE: 'PLATFORM_LATITUDE',
  PLATFORM_LONGITUDE: 'PLATFORM_LONGITUDE',
} as const;

export type SettingKey = keyof typeof SETTING_KEYS;

const KNOWN_DESCRIPTIONS: Record<string, string> = {
  HOMEPAGE_BANNER: 'نام فایل تصویر بنر بالای صفحه اصلی',
  VERIFICATION_FEE: 'مبلغ کارشناسی هر کالا (تومان)',
  SHIPPING_COST: 'هزینه ارسال پیش‌فرض (تومان)',
  PLATFORM_ADDRESS: 'آدرس دفتر / هاب طبقه',
  SUPPORT_PHONE: 'شماره پشتیبانی',
  SUPPORT_EMAIL: 'ایمیل پشتیبانی',
  BANK_CARD_NUMBER: 'شماره کارت بانکی واریز',
  BANK_ACCOUNT_HOLDER: 'نام دارنده حساب بانکی',
  BANK_SHABA: 'شماره شبا جهت واریز',
  TERMS_CONDITIONS: 'متن قوانین و مقررات (نمایش به کاربران)',
  ABOUT_US: 'متن صفحه درباره ما',
  REPAIR_ALLOWED_CATEGORY_IDS: 'لیست دسته‌بندی‌های مجاز برای ثبت تعمیرات (JSON)',
  PLATFORM_LATITUDE: 'مختصات جغرافیایی عرض (Latitude) مرکز طبقه',
  PLATFORM_LONGITUDE: 'مختصات جغرافیایی طول (Longitude) مرکز طبقه',
};

@Injectable()
export class AdminSettingsService {
  constructor(private readonly prisma: PrismaService) {}

  list() {
    return this.prisma.systemSetting.findMany({ orderBy: { key: 'asc' } });
  }

  /**
   * Returns a map of all known site settings merged with their current values.
   * Keys that don't exist yet in DB are returned with empty string values so the
   * admin UI can render a complete form.
   */
  async getSiteConfig() {
    const rows = await this.prisma.systemSetting.findMany({
      where: { key: { in: Object.values(SETTING_KEYS) } },
    });

    const byKey = new Map(rows.map((r) => [r.key, r]));
    const result: Record<string, string> = {};
    for (const key of Object.values(SETTING_KEYS)) {
      result[key] = byKey.get(key)?.value ?? '';
    }
    return result;
  }

  async upsert(dto: UpsertSettingDto) {
    const description = dto.description ?? KNOWN_DESCRIPTIONS[dto.key] ?? null;
    return this.prisma.systemSetting.upsert({
      where: { key: dto.key },
      update: { value: dto.value, description },
      create: { key: dto.key, value: dto.value, description },
    });
  }

  async upsertMany(dto: BulkUpsertSettingsDto) {
    return this.prisma.$transaction(
      dto.items.map((item) => {
        const description = item.description ?? KNOWN_DESCRIPTIONS[item.key] ?? null;
        return this.prisma.systemSetting.upsert({
          where: { key: item.key },
          update: { value: item.value, description },
          create: { key: item.key, value: item.value, description },
        });
      }),
    );
  }

  async remove(key: string) {
    const existing = await this.prisma.systemSetting.findUnique({ where: { key } });
    if (!existing) throw new NotFoundException('کلید تنظیمات یافت نشد');

    if (key === SETTING_KEYS.HOMEPAGE_BANNER && existing.value) {
      this.deleteBannerFile(existing.value);
    }

    await this.prisma.systemSetting.delete({ where: { key } });
    return { key };
  }

  async setBanner(filename: string) {
    if (!filename) throw new BadRequestException('فایل بنر نامعتبر است');

    const previous = await this.prisma.systemSetting.findUnique({
      where: { key: SETTING_KEYS.HOMEPAGE_BANNER },
    });

    if (previous?.value && previous.value !== filename) {
      this.deleteBannerFile(previous.value);
    }

    return this.upsert({
      key: SETTING_KEYS.HOMEPAGE_BANNER,
      value: filename,
      description: KNOWN_DESCRIPTIONS.HOMEPAGE_BANNER,
    });
  }

  async removeBanner() {
    const existing = await this.prisma.systemSetting.findUnique({
      where: { key: SETTING_KEYS.HOMEPAGE_BANNER },
    });
    if (existing?.value) this.deleteBannerFile(existing.value);

    await this.prisma.systemSetting.upsert({
      where: { key: SETTING_KEYS.HOMEPAGE_BANNER },
      update: { value: '' },
      create: {
        key: SETTING_KEYS.HOMEPAGE_BANNER,
        value: '',
        description: KNOWN_DESCRIPTIONS.HOMEPAGE_BANNER,
      },
    });
    return { ok: true };
  }

  private deleteBannerFile(filename: string) {
    try {
      const safeName = filename.split(/[\\/]/).pop();
      if (!safeName) return;
      const fullPath = join(process.cwd(), BANNER_UPLOAD_PATH.replace(/^\.\//, ''), safeName);
      if (existsSync(fullPath)) {
        unlink(fullPath, () => undefined);
      }
    } catch {
      // non-fatal
    }
  }
}
