import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { existsSync, unlink } from 'fs';
import { join } from 'path';
import { PrismaService } from '../../../infrastructure/prisma/prisma.service';
import { BulkUpsertSettingsDto, UpsertSettingDto } from '../dto/admin-setting.dto';
import { BANNER_UPLOAD_PATH } from '../../../common/upload/banner-upload.config';
import { BRAND_LOGO_UPLOAD_PATH } from '../../../common/upload/brand-logo-upload.config';

export const SETTING_KEYS = {
  HOMEPAGE_BANNER: 'HOMEPAGE_BANNER',
  MEDIA_FALLBACK_LOGO: 'MEDIA_FALLBACK_LOGO',
  USER_APP_LOGO: 'USER_APP_LOGO',
  ADMIN_PANEL_LOGO: 'ADMIN_PANEL_LOGO',
  CRITICAL_ALERT_ENABLED: 'CRITICAL_ALERT_ENABLED',
  CRITICAL_ALERT_LABEL: 'CRITICAL_ALERT_LABEL',
  CRITICAL_ALERT_TEXT: 'CRITICAL_ALERT_TEXT',
  CRITICAL_ALERT_BG_COLOR: 'CRITICAL_ALERT_BG_COLOR',
  CRITICAL_ALERT_TEXT_COLOR: 'CRITICAL_ALERT_TEXT_COLOR',
  VERIFICATION_FEE: 'VERIFICATION_FEE',
  SHIPPING_COST: 'SHIPPING_COST',
  SELLER_SHIP_DEADLINE_MINUTES: 'SELLER_SHIP_DEADLINE_MINUTES',
  BUYER_CONFIRM_DEADLINE_MINUTES: 'BUYER_CONFIRM_DEADLINE_MINUTES',
  EXCHANGE_NO_SHIPMENT_COMPENSATION: 'EXCHANGE_NO_SHIPMENT_COMPENSATION',
  PLATFORM_ADDRESS: 'PLATFORM_ADDRESS',
  PLATFORM_ADDRESSES: 'PLATFORM_ADDRESSES',
  SUPPORT_PHONE: 'SUPPORT_PHONE',
  SUPPORT_EMAIL: 'SUPPORT_EMAIL',
  BANK_CARD_NUMBER: 'BANK_CARD_NUMBER',
  BANK_ACCOUNT_HOLDER: 'BANK_ACCOUNT_HOLDER',
  BANK_SHABA: 'BANK_SHABA',
  MANUAL_CARD_TRANSFER_MAX: 'MANUAL_CARD_TRANSFER_MAX',
  TERMS_CONDITIONS: 'TERMS_CONDITIONS',
  ABOUT_US: 'ABOUT_US',
  REPAIR_ALLOWED_CATEGORY_IDS: 'REPAIR_ALLOWED_CATEGORY_IDS',
  PLATFORM_LATITUDE: 'PLATFORM_LATITUDE',
  PLATFORM_LONGITUDE: 'PLATFORM_LONGITUDE',
} as const;

export type SettingKey = keyof typeof SETTING_KEYS;

const KNOWN_DESCRIPTIONS: Record<string, string> = {
  HOMEPAGE_BANNER: 'نام فایل تصویر بنر بالای صفحه اصلی',
  MEDIA_FALLBACK_LOGO: 'لوگوی جایگزین وقتی تصویر آگهی/بندانگشتی لود نمی‌شود',
  USER_APP_LOGO: 'لوگوی سمت کاربر (هدر و داشبورد کاربر)',
  ADMIN_PANEL_LOGO: 'لوگوی پنل مدیریت',
  CRITICAL_ALERT_ENABLED: 'وضعیت نمایش اعلان بحرانی سراسری (true/false)',
  CRITICAL_ALERT_LABEL: 'متن لیبل اعلان بحرانی سراسری',
  CRITICAL_ALERT_TEXT: 'متن اعلان بحرانی سراسری',
  CRITICAL_ALERT_BG_COLOR: 'رنگ پس‌زمینه اعلان بحرانی (hex)',
  CRITICAL_ALERT_TEXT_COLOR: 'رنگ متن اعلان بحرانی (hex)',
  VERIFICATION_FEE: 'مبلغ کارشناسی هر کالا (تومان)',
  SHIPPING_COST: 'هزینه ارسال پیش‌فرض (تومان)',
  SELLER_SHIP_DEADLINE_MINUTES: 'مهلت ارسال فروشنده پس از پرداخت (دقیقه)',
  BUYER_CONFIRM_DEADLINE_MINUTES: 'مهلت تایید/شکایت خریدار پس از ارسال (دقیقه)',
  EXCHANGE_NO_SHIPMENT_COMPENSATION: 'مبلغ دلجویی برای طرف ارسال‌کننده در صورت عدم ارسال طرف مقابل (تومان)',
  PLATFORM_ADDRESS: 'آدرس دفتر / هاب طبقه',
  PLATFORM_ADDRESSES: 'لیست آدرس‌های هاب طبقه با کد پستی (JSON)',
  SUPPORT_PHONE: 'شماره پشتیبانی',
  SUPPORT_EMAIL: 'ایمیل پشتیبانی',
  BANK_CARD_NUMBER: 'شماره کارت بانکی واریز',
  BANK_ACCOUNT_HOLDER: 'نام دارنده حساب بانکی',
  BANK_SHABA: 'شماره شبا جهت واریز',
  MANUAL_CARD_TRANSFER_MAX: 'حداکثر مبلغ مجاز کارت‌به‌کارت (تومان)',
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
      where: {
        key: {
          in: [
            ...Object.values(SETTING_KEYS),
            'SELLER_SHIP_DEADLINE_DAYS',
            'BUYER_CONFIRM_DEADLINE_DAYS',
          ],
        },
      },
    });

    const byKey = new Map(rows.map((r) => [r.key, r]));
    const result: Record<string, string> = {};
    for (const key of Object.values(SETTING_KEYS)) {
      if (key === SETTING_KEYS.SELLER_SHIP_DEADLINE_MINUTES) {
        const minutes = byKey.get(key)?.value;
        if (minutes) {
          result[key] = minutes;
          continue;
        }
        const legacyDays = Number(byKey.get('SELLER_SHIP_DEADLINE_DAYS')?.value ?? '');
        result[key] = Number.isFinite(legacyDays) && legacyDays > 0
          ? String(Math.floor(legacyDays * 24 * 60))
          : '';
        continue;
      }
      if (key === SETTING_KEYS.BUYER_CONFIRM_DEADLINE_MINUTES) {
        const minutes = byKey.get(key)?.value;
        if (minutes) {
          result[key] = minutes;
          continue;
        }
        const legacyDays = Number(byKey.get('BUYER_CONFIRM_DEADLINE_DAYS')?.value ?? '');
        result[key] = Number.isFinite(legacyDays) && legacyDays > 0
          ? String(Math.floor(legacyDays * 24 * 60))
          : '';
        continue;
      }
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
    if (
      (key === SETTING_KEYS.MEDIA_FALLBACK_LOGO ||
        key === SETTING_KEYS.USER_APP_LOGO ||
        key === SETTING_KEYS.ADMIN_PANEL_LOGO) &&
      existing.value
    ) {
      this.deleteBrandLogoFile(existing.value);
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

  async setMediaFallbackLogo(filename: string) {
    if (!filename) throw new BadRequestException('فایل لوگو نامعتبر است');

    const previous = await this.prisma.systemSetting.findUnique({
      where: { key: SETTING_KEYS.MEDIA_FALLBACK_LOGO },
    });

    if (previous?.value && previous.value !== filename) {
      this.deleteBrandLogoFile(previous.value);
    }

    return this.upsert({
      key: SETTING_KEYS.MEDIA_FALLBACK_LOGO,
      value: filename,
      description: KNOWN_DESCRIPTIONS.MEDIA_FALLBACK_LOGO,
    });
  }

  async setUserAppLogo(filename: string) {
    if (!filename) throw new BadRequestException('فایل لوگوی کاربر نامعتبر است');
    return this.setBrandLogoByKey(SETTING_KEYS.USER_APP_LOGO, filename);
  }

  async setAdminPanelLogo(filename: string) {
    if (!filename) throw new BadRequestException('فایل لوگوی ادمین نامعتبر است');
    return this.setBrandLogoByKey(SETTING_KEYS.ADMIN_PANEL_LOGO, filename);
  }

  async removeMediaFallbackLogo() {
    const existing = await this.prisma.systemSetting.findUnique({
      where: { key: SETTING_KEYS.MEDIA_FALLBACK_LOGO },
    });
    if (existing?.value) this.deleteBrandLogoFile(existing.value);

    await this.prisma.systemSetting.upsert({
      where: { key: SETTING_KEYS.MEDIA_FALLBACK_LOGO },
      update: { value: '' },
      create: {
        key: SETTING_KEYS.MEDIA_FALLBACK_LOGO,
        value: '',
        description: KNOWN_DESCRIPTIONS.MEDIA_FALLBACK_LOGO,
      },
    });
    return { ok: true };
  }

  async removeUserAppLogo() {
    return this.clearBrandLogoByKey(SETTING_KEYS.USER_APP_LOGO);
  }

  async removeAdminPanelLogo() {
    return this.clearBrandLogoByKey(SETTING_KEYS.ADMIN_PANEL_LOGO);
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

  private deleteBrandLogoFile(filename: string) {
    try {
      const safeName = filename.split(/[\\/]/).pop();
      if (!safeName) return;
      const fullPath = join(process.cwd(), BRAND_LOGO_UPLOAD_PATH.replace(/^\.\//, ''), safeName);
      if (existsSync(fullPath)) {
        unlink(fullPath, () => undefined);
      }
    } catch {
      // non-fatal
    }
  }

  private async setBrandLogoByKey(key: string, filename: string) {
    const previous = await this.prisma.systemSetting.findUnique({ where: { key } });
    if (previous?.value && previous.value !== filename) {
      this.deleteBrandLogoFile(previous.value);
    }

    return this.upsert({
      key,
      value: filename,
      description: KNOWN_DESCRIPTIONS[key],
    });
  }

  private async clearBrandLogoByKey(key: string) {
    const existing = await this.prisma.systemSetting.findUnique({ where: { key } });
    if (existing?.value) this.deleteBrandLogoFile(existing.value);

    await this.prisma.systemSetting.upsert({
      where: { key },
      update: { value: '' },
      create: {
        key,
        value: '',
        description: KNOWN_DESCRIPTIONS[key] ?? null,
      },
    });
    return { ok: true };
  }
}
