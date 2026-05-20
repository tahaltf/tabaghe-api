import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { existsSync, unlink } from 'fs';
import { join } from 'path';
import { PrismaService } from '../../../infrastructure/prisma/prisma.service';
import {
  BulkUpsertSettingsDto,
  UpsertSettingDto,
} from '../dto/admin-setting.dto';
import { BANNER_UPLOAD_PATH } from '../../../common/upload/banner-upload.config';
import { BRAND_LOGO_UPLOAD_PATH } from '../../../common/upload/brand-logo-upload.config';
import { INSPECTION_CERTIFICATE_ASSET_UPLOAD_PATH } from '../../../common/upload/inspection-certificate-asset-upload.config';
import { LISTING_TYPE_ENABLED_SETTING_KEYS } from '../../../common/system-settings/listing-type-enabled';

export const SETTING_KEYS = {
  HOMEPAGE_BANNER: 'HOMEPAGE_BANNER',
  MEDIA_FALLBACK_LOGO: 'MEDIA_FALLBACK_LOGO',
  /** لوگوی تم روشن (هدر، داشبورد، …) — در صورت خالی بودن از USER_APP_LOGO قدیمی استفاده می‌شود */
  USER_APP_LOGO_LIGHT: 'USER_APP_LOGO_LIGHT',
  /** لوگوی تم تاریک */
  USER_APP_LOGO_DARK: 'USER_APP_LOGO_DARK',
  /** @deprecated فقط برای سازگاری؛ ترجیح با LIGHT/DARK */
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
  SELLER_RETURN_CONFIRM_DEADLINE_MINUTES:
    'SELLER_RETURN_CONFIRM_DEADLINE_MINUTES',
  BUYER_CONFIRM_DEADLINE_MINUTES: 'BUYER_CONFIRM_DEADLINE_MINUTES',
  LISTING_DISPLAY_DAYS: 'LISTING_DISPLAY_DAYS',
  LISTING_TYPE_DIRECT_ENABLED: LISTING_TYPE_ENABLED_SETTING_KEYS.DIRECT,
  LISTING_TYPE_EXCHANGE_ENABLED: LISTING_TYPE_ENABLED_SETTING_KEYS.EXCHANGE,
  LISTING_TYPE_AUCTION_ENABLED: LISTING_TYPE_ENABLED_SETTING_KEYS.AUCTION,
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
  SMS_NOTIFICATION_RULES: 'SMS_NOTIFICATION_RULES',
  SMS_OTP_TEMPLATE_ID: 'SMS_OTP_TEMPLATE_ID',
  SMS_OTP_CODE_PARAMETER_NAME: 'SMS_OTP_CODE_PARAMETER_NAME',
  SMS_ADMIN_LOGIN_ALERT_ENABLED: 'SMS_ADMIN_LOGIN_ALERT_ENABLED',
  SMS_ADMIN_LOGIN_ALERT_TEMPLATE_ID: 'SMS_ADMIN_LOGIN_ALERT_TEMPLATE_ID',
  SMS_ADMIN_LOGIN_ALERT_RECIPIENTS: 'SMS_ADMIN_LOGIN_ALERT_RECIPIENTS',
  SMS_ADMIN_LOGIN_ALERT_USER_PHONE_PARAMETER:
    'SMS_ADMIN_LOGIN_ALERT_USER_PHONE_PARAMETER',
  SYSTEM_INTRO_CONTENT: 'SYSTEM_INTRO_CONTENT',
  FOOTER_SOCIAL_LINKS: 'FOOTER_SOCIAL_LINKS',
  AUCTION_DEPOSIT_MIN: 'AUCTION_DEPOSIT_MIN',
  AUCTION_DEPOSIT_MAX: 'AUCTION_DEPOSIT_MAX',
  AUCTION_MAX_BIDS_PER_MINUTE: 'AUCTION_MAX_BIDS_PER_MINUTE',
  AUCTION_MAX_ACTIVE_AUCTIONS_PER_USER: 'AUCTION_MAX_ACTIVE_AUCTIONS_PER_USER',
  AUCTION_MIN_TRUST_SCORE: 'AUCTION_MIN_TRUST_SCORE',
  AUCTION_ALERT_PENDING_THRESHOLD: 'AUCTION_ALERT_PENDING_THRESHOLD',
  AUCTION_ALERT_FAILED_THRESHOLD: 'AUCTION_ALERT_FAILED_THRESHOLD',
  AUCTION_ALERT_COOLDOWN_MINUTES: 'AUCTION_ALERT_COOLDOWN_MINUTES',
  INSPECTION_CERTIFICATE_TITLE: 'INSPECTION_CERTIFICATE_TITLE',
  INSPECTION_CERTIFICATE_BODY: 'INSPECTION_CERTIFICATE_BODY',
  INSPECTION_CERTIFICATE_FOOTER: 'INSPECTION_CERTIFICATE_FOOTER',
  INSPECTION_CERTIFICATE_LOGO: 'INSPECTION_CERTIFICATE_LOGO',
  INSPECTION_CERTIFICATE_STAMP: 'INSPECTION_CERTIFICATE_STAMP',
} as const;

/**
 * متن پیش‌فرض گواهی کارشناسی. ادمین می‌تواند از پنل ادیت کند.
 * Placeholderهای پشتیبانی‌شده توسط InspectionCertificateService جایگزین می‌شوند.
 */
export const DEFAULT_INSPECTION_CERTIFICATE_TITLE = 'گواهی کارشناسی کالا';
export const DEFAULT_INSPECTION_CERTIFICATE_BODY = `بدینوسیله گواهی می‌شود کالای زیر متعلق به جناب/سرکار خانم {{ownerName}} با شناسه ملی {{ownerNationalCode}} توسط کارشناسان مرکز پردازش طبقه مورد بررسی فنی و سلامت قرار گرفته و سالم و مطابق با مشخصات اعلامی تایید گردید.

مشخصات کالا:
- عنوان: {{itemTitle}}
- دسته‌بندی: {{categoryTitle}}
- وضعیت: {{itemCondition}}
- شماره سفارش: {{orderId}}
- شماره گواهی: {{certificateNumber}}
- تاریخ کارشناسی: {{verifiedDate}}

نتیجه کارشناسی: {{inspectionResult}}

این گواهی صرفاً جهت اعلام نتیجه بررسی فنی توسط کارشناسان طبقه صادر شده و معتبر می‌باشد.`;
export const DEFAULT_INSPECTION_CERTIFICATE_FOOTER = `مرکز پردازش و کارشناسی طبقه
آدرس: {{platformAddress}}
تلفن پشتیبانی: {{supportPhone}}`;

export type SettingKey = keyof typeof SETTING_KEYS;

const KNOWN_DESCRIPTIONS: Record<string, string> = {
  HOMEPAGE_BANNER: 'نام فایل تصویر بنر بالای صفحه اصلی',
  MEDIA_FALLBACK_LOGO: 'لوگوی جایگزین وقتی تصویر آگهی/بندانگشتی لود نمی‌شود',
  USER_APP_LOGO_LIGHT: 'لوگوی رابط کاربر — تم روشن',
  USER_APP_LOGO_DARK: 'لوگوی رابط کاربر — تم تاریک',
  USER_APP_LOGO: 'لوگوی سمت کاربر (قدیمی؛ در صورت خالی بودن LIGHT/DARK استفاده می‌شود)',
  ADMIN_PANEL_LOGO: 'لوگوی پنل مدیریت',
  CRITICAL_ALERT_ENABLED: 'وضعیت نمایش اعلان بحرانی سراسری (true/false)',
  CRITICAL_ALERT_LABEL: 'متن لیبل اعلان بحرانی سراسری',
  CRITICAL_ALERT_TEXT: 'متن اعلان بحرانی سراسری',
  CRITICAL_ALERT_BG_COLOR: 'رنگ پس‌زمینه اعلان بحرانی (hex)',
  CRITICAL_ALERT_TEXT_COLOR: 'رنگ متن اعلان بحرانی (hex)',
  VERIFICATION_FEE: 'مبلغ کارشناسی هر کالا (تومان)',
  SHIPPING_COST: 'هزینه ارسال پیش‌فرض (تومان)',
  SELLER_SHIP_DEADLINE_MINUTES: 'مهلت ارسال فروشنده پس از پرداخت (دقیقه)',
  SELLER_RETURN_CONFIRM_DEADLINE_MINUTES:
    'مهلت تأیید دریافت مرجوعی توسط فروشنده؛ پس از شکایت و ثبت بازگشت کالا؛ در صورت تأخیر قطعی تأیید (دقیقه)',
  BUYER_CONFIRM_DEADLINE_MINUTES: 'مهلت تایید/شکایت خریدار پس از ارسال (دقیقه)',
  LISTING_DISPLAY_DAYS:
    'پس از تایید ادمین، آگهی چند روز روی سایت می‌ماند (۱ تا ۳۶۵). یک روز قبل از پایان به فروشنده اطلاع داده می‌شود؛ پس از اتمام آرشیو می‌شود.',
  LISTING_TYPE_DIRECT_ENABLED:
    'فعال بودن ثبت آگهی فروش مستقیم برای کاربران (true/false)',
  LISTING_TYPE_EXCHANGE_ENABLED:
    'فعال بودن ثبت آگهی معاوضه برای کاربران (true/false)',
  LISTING_TYPE_AUCTION_ENABLED:
    'فعال بودن ثبت آگهی مزایده برای کاربران (true/false)',
  EXCHANGE_NO_SHIPMENT_COMPENSATION:
    'مبلغ دلجویی برای طرف ارسال‌کننده در صورت عدم ارسال طرف مقابل (تومان)',
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
  REPAIR_ALLOWED_CATEGORY_IDS:
    'لیست دسته‌بندی‌های مجاز برای ثبت تعمیرات (JSON)',
  PLATFORM_LATITUDE: 'مختصات جغرافیایی عرض (Latitude) مرکز طبقه',
  PLATFORM_LONGITUDE: 'مختصات جغرافیایی طول (Longitude) مرکز طبقه',
  SMS_NOTIFICATION_RULES: 'پالیسی نوتیف/پیامک به ازای نوع رویداد (JSON)',
  SMS_OTP_TEMPLATE_ID: 'شناسه قالب پیامک ورود (OTP) در sms.ir',
  SMS_OTP_CODE_PARAMETER_NAME:
    'نام پارامتر قالب OTP که مقدار کد در آن قرار می‌گیرد (مثلاً CONTACTS)',
  SMS_ADMIN_LOGIN_ALERT_ENABLED:
    'ارسال پیامک به ادمین پس از ورود کاربر (true/false، پیش‌فرض true)',
  SMS_ADMIN_LOGIN_ALERT_TEMPLATE_ID:
    'شناسه قالب پیامک «ورود کاربر» برای اطلاع ادمین در sms.ir',
  SMS_ADMIN_LOGIN_ALERT_RECIPIENTS:
    'شماره‌های ادمین برای دریافت هشدار ورود (جدا با ویرگول، مثلاً 0912...,0913...)',
  SMS_ADMIN_LOGIN_ALERT_USER_PHONE_PARAMETER:
    'نام پارامتر قالب هشدار ورود که شمارهٔ کاربر واردشده در آن قرار می‌گیرد (مثلاً PHONE)',
  SYSTEM_INTRO_CONTENT: 'محتوای صفحه معرفی سامانه',
  FOOTER_SOCIAL_LINKS:
    'لینک‌های شبکه‌های اجتماعی فوتر (JSON آرایه: [{ "network": "instagram", "url": "https://..." }])',
  AUCTION_DEPOSIT_MIN: 'حداقل ودیعه ورود مزایده (تومان)',
  AUCTION_DEPOSIT_MAX: 'حداکثر ودیعه ورود مزایده (تومان)',
  AUCTION_MAX_BIDS_PER_MINUTE:
    'حداکثر تعداد ثبت پیشنهاد برای هر کاربر در هر دقیقه',
  AUCTION_MAX_ACTIVE_AUCTIONS_PER_USER:
    'حداکثر تعداد مزایده‌های فعال قابل مشارکت برای هر کاربر',
  AUCTION_MIN_TRUST_SCORE: 'حداقل امتیاز اعتماد برای مشارکت در مزایده',
  AUCTION_ALERT_PENDING_THRESHOLD:
    'آستانه هشدار تعداد مزایده‌های در انتظار تسویه',
  AUCTION_ALERT_FAILED_THRESHOLD: 'آستانه هشدار تعداد مزایده‌های شکست‌خورده',
  AUCTION_ALERT_COOLDOWN_MINUTES:
    'حداقل فاصله زمانی بین alertهای سلامت مزایده (دقیقه)',
  INSPECTION_CERTIFICATE_TITLE:
    'عنوان گواهی کارشناسی کالا (نمایش بالای گواهی PDF)',
  INSPECTION_CERTIFICATE_BODY:
    'متن اصلی گواهی کارشناسی؛ از placeholderهایی مثل {{ownerName}}, {{itemTitle}}, {{verifiedDate}} پشتیبانی می‌کند',
  INSPECTION_CERTIFICATE_FOOTER:
    'پاورقی گواهی کارشناسی (نام مرکز، آدرس، تلفن پشتیبانی)',
  INSPECTION_CERTIFICATE_LOGO: 'فایل لوگوی بالای گواهی کارشناسی PDF',
  INSPECTION_CERTIFICATE_STAMP: 'فایل تصویر مهر/امضای پایین گواهی کارشناسی PDF',
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
            'SELLER_RETURN_CONFIRM_DEADLINE_HOURS',
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
        const legacyDays = Number(
          byKey.get('SELLER_SHIP_DEADLINE_DAYS')?.value ?? '',
        );
        result[key] =
          Number.isFinite(legacyDays) && legacyDays > 0
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
        const legacyDays = Number(
          byKey.get('BUYER_CONFIRM_DEADLINE_DAYS')?.value ?? '',
        );
        result[key] =
          Number.isFinite(legacyDays) && legacyDays > 0
            ? String(Math.floor(legacyDays * 24 * 60))
            : '';
        continue;
      }
      if (key === SETTING_KEYS.SELLER_RETURN_CONFIRM_DEADLINE_MINUTES) {
        const minutes = byKey.get(key)?.value?.trim();
        if (minutes) {
          result[key] = minutes;
          continue;
        }
        const legacyHours = Number(
          byKey.get('SELLER_RETURN_CONFIRM_DEADLINE_HOURS')?.value ?? '',
        );
        result[key] =
          Number.isFinite(legacyHours) && legacyHours > 0
            ? String(Math.floor(legacyHours * 60))
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
        const description =
          item.description ?? KNOWN_DESCRIPTIONS[item.key] ?? null;
        return this.prisma.systemSetting.upsert({
          where: { key: item.key },
          update: { value: item.value, description },
          create: { key: item.key, value: item.value, description },
        });
      }),
    );
  }

  async remove(key: string) {
    const existing = await this.prisma.systemSetting.findUnique({
      where: { key },
    });
    if (!existing) throw new NotFoundException('کلید تنظیمات یافت نشد');

    if (key === SETTING_KEYS.HOMEPAGE_BANNER && existing.value) {
      this.deleteBannerFile(existing.value);
    }
    if (
      (key === SETTING_KEYS.MEDIA_FALLBACK_LOGO ||
        key === SETTING_KEYS.USER_APP_LOGO ||
        key === SETTING_KEYS.USER_APP_LOGO_LIGHT ||
        key === SETTING_KEYS.USER_APP_LOGO_DARK ||
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
    if (!filename)
      throw new BadRequestException('فایل لوگوی کاربر نامعتبر است');
    return this.setBrandLogoByKey(SETTING_KEYS.USER_APP_LOGO, filename);
  }

  async setUserAppLogoLight(filename: string) {
    if (!filename)
      throw new BadRequestException('فایل لوگوی تم روشن نامعتبر است');
    return this.setBrandLogoByKey(SETTING_KEYS.USER_APP_LOGO_LIGHT, filename);
  }

  async setUserAppLogoDark(filename: string) {
    if (!filename)
      throw new BadRequestException('فایل لوگوی تم تاریک نامعتبر است');
    return this.setBrandLogoByKey(SETTING_KEYS.USER_APP_LOGO_DARK, filename);
  }

  async setAdminPanelLogo(filename: string) {
    if (!filename)
      throw new BadRequestException('فایل لوگوی ادمین نامعتبر است');
    return this.setBrandLogoByKey(SETTING_KEYS.ADMIN_PANEL_LOGO, filename);
  }

  async setInspectionCertificateLogo(filename: string) {
    if (!filename)
      throw new BadRequestException('فایل لوگوی گواهی نامعتبر است');
    return this.setInspectionCertAssetByKey(
      SETTING_KEYS.INSPECTION_CERTIFICATE_LOGO,
      filename,
    );
  }

  async setInspectionCertificateStamp(filename: string) {
    if (!filename) throw new BadRequestException('فایل مهر گواهی نامعتبر است');
    return this.setInspectionCertAssetByKey(
      SETTING_KEYS.INSPECTION_CERTIFICATE_STAMP,
      filename,
    );
  }

  async removeInspectionCertificateLogo() {
    return this.clearInspectionCertAssetByKey(
      SETTING_KEYS.INSPECTION_CERTIFICATE_LOGO,
    );
  }

  async removeInspectionCertificateStamp() {
    return this.clearInspectionCertAssetByKey(
      SETTING_KEYS.INSPECTION_CERTIFICATE_STAMP,
    );
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

  async removeUserAppLogoLight() {
    return this.clearBrandLogoByKey(SETTING_KEYS.USER_APP_LOGO_LIGHT);
  }

  async removeUserAppLogoDark() {
    return this.clearBrandLogoByKey(SETTING_KEYS.USER_APP_LOGO_DARK);
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
      const fullPath = join(
        process.cwd(),
        BANNER_UPLOAD_PATH.replace(/^\.\//, ''),
        safeName,
      );
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
      const fullPath = join(
        process.cwd(),
        BRAND_LOGO_UPLOAD_PATH.replace(/^\.\//, ''),
        safeName,
      );
      if (existsSync(fullPath)) {
        unlink(fullPath, () => undefined);
      }
    } catch {
      // non-fatal
    }
  }

  private async setBrandLogoByKey(key: string, filename: string) {
    const previous = await this.prisma.systemSetting.findUnique({
      where: { key },
    });
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
    const existing = await this.prisma.systemSetting.findUnique({
      where: { key },
    });
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

  private deleteInspectionCertAssetFile(filename: string) {
    try {
      const safeName = filename.split(/[\\/]/).pop();
      if (!safeName) return;
      const fullPath = join(
        process.cwd(),
        INSPECTION_CERTIFICATE_ASSET_UPLOAD_PATH.replace(/^\.\//, ''),
        safeName,
      );
      if (existsSync(fullPath)) {
        unlink(fullPath, () => undefined);
      }
    } catch {
      // non-fatal
    }
  }

  private async setInspectionCertAssetByKey(key: string, filename: string) {
    const previous = await this.prisma.systemSetting.findUnique({
      where: { key },
    });
    if (previous?.value && previous.value !== filename) {
      this.deleteInspectionCertAssetFile(previous.value);
    }

    return this.upsert({
      key,
      value: filename,
      description: KNOWN_DESCRIPTIONS[key],
    });
  }

  private async clearInspectionCertAssetByKey(key: string) {
    const existing = await this.prisma.systemSetting.findUnique({
      where: { key },
    });
    if (existing?.value) this.deleteInspectionCertAssetFile(existing.value);

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
