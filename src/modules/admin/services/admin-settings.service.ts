import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { existsSync, unlink } from 'fs';
import { join } from 'path';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../../infrastructure/prisma/prisma.service';
import {
  BulkUpsertSettingsDto,
  UpsertSettingDto,
} from '../dto/admin-setting.dto';
import { BANNER_UPLOAD_PATH } from '../../../common/upload/banner-upload.config';
import { BRAND_LOGO_UPLOAD_PATH } from '../../../common/upload/brand-logo-upload.config';
import { INSPECTION_CERTIFICATE_ASSET_UPLOAD_PATH } from '../../../common/upload/inspection-certificate-asset-upload.config';
import { LISTING_TYPE_ENABLED_SETTING_KEYS } from '../../../common/system-settings/listing-type-enabled';
import { PwaIconService } from '../../../common-module/pwa-icon.service';
import { appendJsonLog } from '../../../common/logging/app-log.util';
import { AuthenticatedUser } from '../../../shared/contracts/auth';
import {
  mergeHomepageLayout,
  validateHomepageLayout,
} from '../../../common/homepage/homepage-layout.util';
import type { HomePageLayout } from '../../../shared/contracts/homepage-layout';
import { ListingExpiryService } from '../../listing/services/listing-expiry.service';
import { AppSettingsService } from '../../../shared/settings/app-settings.service';
import { TtlCacheService } from '../../../infrastructure/cache/ttl-cache.service';
import {
  PAYMENT_GATEWAY_CATALOG,
  parsePaymentGatewaysJson,
  serializePaymentGatewaysJson,
  validatePaymentGatewaysJson,
} from '../../payments/payment-gateways.catalog';
import {
  migrateEnamadToLicenses,
  parseEnamadTag,
  serializeSiteLicensesJson,
  validateSiteLicensesJson,
} from '../../../common/content/site-licenses.util';

export const SETTING_KEYS = {
  HOMEPAGE_BANNER: 'HOMEPAGE_BANNER',
  HOMEPAGE_LAYOUT: 'HOMEPAGE_LAYOUT',
  MEDIA_FALLBACK_LOGO: 'MEDIA_FALLBACK_LOGO',
  /** لوگوی تم روشن (هدر، داشبورد، …) — در صورت خالی بودن از USER_APP_LOGO قدیمی استفاده می‌شود */
  USER_APP_LOGO_LIGHT: 'USER_APP_LOGO_LIGHT',
  /** لوگوی تم تاریک */
  USER_APP_LOGO_DARK: 'USER_APP_LOGO_DARK',
  /** @deprecated فقط برای سازگاری؛ ترجیح با LIGHT/DARK */
  USER_APP_LOGO: 'USER_APP_LOGO',
  PWA_APP_NAME: 'PWA_APP_NAME',
  PWA_APP_SHORT_NAME: 'PWA_APP_SHORT_NAME',
  PWA_APP_ICON: 'PWA_APP_ICON',
  PWA_APP_FAVICON: 'PWA_APP_FAVICON',
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
  LISTING_REVIEW_SLA_HOURS: 'LISTING_REVIEW_SLA_HOURS',
  LISTING_TYPE_DIRECT_ENABLED: LISTING_TYPE_ENABLED_SETTING_KEYS.DIRECT,
  LISTING_TYPE_EXCHANGE_ENABLED: LISTING_TYPE_ENABLED_SETTING_KEYS.EXCHANGE,
  LISTING_TYPE_AUCTION_ENABLED: LISTING_TYPE_ENABLED_SETTING_KEYS.AUCTION,
  PURCHASE_OFFER_VALIDITY_HOURS: 'PURCHASE_OFFER_VALIDITY_HOURS',
  PURCHASE_OFFER_CART_RESERVE_HOURS: 'PURCHASE_OFFER_CART_RESERVE_HOURS',
  EXCHANGE_NO_SHIPMENT_COMPENSATION: 'EXCHANGE_NO_SHIPMENT_COMPENSATION',
  EXCHANGE_PAYMENT_DEADLINE_MINUTES: 'EXCHANGE_PAYMENT_DEADLINE_MINUTES',
  EXCHANGE_SHIP_DEADLINE_MINUTES: 'EXCHANGE_SHIP_DEADLINE_MINUTES',
  AUCTION_PAYMENT_DEADLINE_MINUTES: 'AUCTION_PAYMENT_DEADLINE_MINUTES',
  AUCTION_SECOND_CHANCE_DEADLINE_MINUTES:
    'AUCTION_SECOND_CHANCE_DEADLINE_MINUTES',
  AUCTION_WINNER_PAYMENT_DEADLINE_HOURS:
    'AUCTION_WINNER_PAYMENT_DEADLINE_HOURS',
  AUCTION_SECOND_CHANCE_PAYMENT_DEADLINE_HOURS:
    'AUCTION_SECOND_CHANCE_PAYMENT_DEADLINE_HOURS',
  ORDER_COMPLETED_VIDEO_RETENTION_DAYS: 'ORDER_COMPLETED_VIDEO_RETENTION_DAYS',
  /** نظرسنجی پس از معامله: فعال/غیرفعال */
  POST_PURCHASE_SURVEY_ENABLED: 'POST_PURCHASE_SURVEY_ENABLED',
  /** ساعت تأخیر ارسال لینک نظرسنجی پس از تکمیل معامله */
  POST_PURCHASE_SURVEY_DELAY_HOURS: 'POST_PURCHASE_SURVEY_DELAY_HOURS',
  /** روز اعتبار لینک نظرسنجی پس از ساخت */
  POST_PURCHASE_SURVEY_EXPIRE_DAYS: 'POST_PURCHASE_SURVEY_EXPIRE_DAYS',
  OTP_TTL_MINUTES: 'OTP_TTL_MINUTES',
  OTP_RESEND_COOLDOWN_SECONDS: 'OTP_RESEND_COOLDOWN_SECONDS',
  TRADE_REPUTATION_SUCCESS_DELTA: 'TRADE_REPUTATION_SUCCESS_DELTA',
  TRADE_REPUTATION_PENALTY_DELTA: 'TRADE_REPUTATION_PENALTY_DELTA',
  EXCHANGE_PAYMENT_TRUST_PENALTY: 'EXCHANGE_PAYMENT_TRUST_PENALTY',
  AUCTION_LAST_MINUTE_EXTENSION_MINUTES: 'AUCTION_LAST_MINUTE_EXTENSION_MINUTES',
  PLATFORM_ADDRESS: 'PLATFORM_ADDRESS',
  PLATFORM_ADDRESSES: 'PLATFORM_ADDRESSES',
  SUPPORT_PHONE: 'SUPPORT_PHONE',
  SUPPORT_EMAIL: 'SUPPORT_EMAIL',
  BANK_CARD_NUMBER: 'BANK_CARD_NUMBER',
  BANK_ACCOUNT_HOLDER: 'BANK_ACCOUNT_HOLDER',
  BANK_SHABA: 'BANK_SHABA',
  MANUAL_CARD_TRANSFER_MAX: 'MANUAL_CARD_TRANSFER_MAX',
  TERMS_CONDITIONS: 'TERMS_CONDITIONS',
  TERMS_VERSION: 'TERMS_VERSION',
  PRIVACY_POLICY: 'PRIVACY_POLICY',
  SELLER_TERMS: 'SELLER_TERMS',
  ABOUT_US: 'ABOUT_US',
  FOOTER_TAGLINE: 'FOOTER_TAGLINE',
  ENAMAD_ID: 'ENAMAD_ID',
  ENAMAD_CODE: 'ENAMAD_CODE',
  ENAMAD_ENABLED: 'ENAMAD_ENABLED',
  SITE_LICENSES_JSON: 'SITE_LICENSES_JSON',
  PAYMENT_GATEWAYS_JSON: 'PAYMENT_GATEWAYS_JSON',
  HEADER_NAV_JSON: 'HEADER_NAV_JSON',
  HEADER_ACTIONS_JSON: 'HEADER_ACTIONS_JSON',
  FOOTER_TEXTS_JSON: 'FOOTER_TEXTS_JSON',
  FOOTER_QUICK_LINKS_JSON: 'FOOTER_QUICK_LINKS_JSON',
  REPAIR_ALLOWED_CATEGORY_IDS: 'REPAIR_ALLOWED_CATEGORY_IDS',

  PLATFORM_LATITUDE: 'PLATFORM_LATITUDE',
  PLATFORM_LONGITUDE: 'PLATFORM_LONGITUDE',
  SMS_NOTIFICATION_RULES: 'SMS_NOTIFICATION_RULES',
  ACTIVE_SMS_PROVIDER: 'ACTIVE_SMS_PROVIDER',
  SMS_OTP_SMS_PROVIDER: 'SMS_OTP_SMS_PROVIDER',
  SMS_OTP_TEMPLATE_ID: 'SMS_OTP_TEMPLATE_ID',
  SMS_OTP_TEMPLATE_NAME: 'SMS_OTP_TEMPLATE_NAME',
  SMS_OTP_CODE_PARAMETER_NAME: 'SMS_OTP_CODE_PARAMETER_NAME',
  SMS_WITHDRAW_OTP_TEMPLATE_ID: 'SMS_WITHDRAW_OTP_TEMPLATE_ID',
  SMS_WITHDRAW_OTP_SMS_PROVIDER: 'SMS_WITHDRAW_OTP_SMS_PROVIDER',
  SMS_WITHDRAW_OTP_TEMPLATE_NAME: 'SMS_WITHDRAW_OTP_TEMPLATE_NAME',
  SMS_WITHDRAW_OTP_CODE_PARAMETER_NAME: 'SMS_WITHDRAW_OTP_CODE_PARAMETER_NAME',
  SMS_ADMIN_LOGIN_ALERT_ENABLED: 'SMS_ADMIN_LOGIN_ALERT_ENABLED',
  SMS_ADMIN_LOGIN_ALERT_TEMPLATE_ID: 'SMS_ADMIN_LOGIN_ALERT_TEMPLATE_ID',
  SMS_ADMIN_LOGIN_ALERT_SMS_PROVIDER: 'SMS_ADMIN_LOGIN_ALERT_SMS_PROVIDER',
  SMS_ADMIN_LOGIN_ALERT_TEMPLATE_NAME: 'SMS_ADMIN_LOGIN_ALERT_TEMPLATE_NAME',
  SMS_ADMIN_LOGIN_ALERT_RECIPIENTS: 'SMS_ADMIN_LOGIN_ALERT_RECIPIENTS',
  SMS_ADMIN_LOGIN_ALERT_USER_PHONE_PARAMETER:
    'SMS_ADMIN_LOGIN_ALERT_USER_PHONE_PARAMETER',
  SMS_DEPLOY_ALERT_ENABLED: 'SMS_DEPLOY_ALERT_ENABLED',
  SMS_DEPLOY_ALERT_RECIPIENTS: 'SMS_DEPLOY_ALERT_RECIPIENTS',
  SMS_DEPLOY_ALERT_TEMPLATE_ID: 'SMS_DEPLOY_ALERT_TEMPLATE_ID',
  SMS_DEPLOY_ALERT_TEMPLATE_NAME: 'SMS_DEPLOY_ALERT_TEMPLATE_NAME',
  SMS_DEPLOY_ALERT_STATUS_PARAMETER: 'SMS_DEPLOY_ALERT_STATUS_PARAMETER',
  SMS_DEPLOY_ALERT_DETAIL_PARAMETER: 'SMS_DEPLOY_ALERT_DETAIL_PARAMETER',
  SMS_UPTIME_ALERT_ENABLED: 'SMS_UPTIME_ALERT_ENABLED',
  SMS_UPTIME_ALERT_RECIPIENTS: 'SMS_UPTIME_ALERT_RECIPIENTS',
  SMS_UPTIME_ALERT_TEMPLATE_ID: 'SMS_UPTIME_ALERT_TEMPLATE_ID',
  SMS_UPTIME_ALERT_TEMPLATE_NAME: 'SMS_UPTIME_ALERT_TEMPLATE_NAME',
  SMS_UPTIME_ALERT_STATUS_PARAMETER: 'SMS_UPTIME_ALERT_STATUS_PARAMETER',
  SMS_UPTIME_ALERT_DETAIL_PARAMETER: 'SMS_UPTIME_ALERT_DETAIL_PARAMETER',
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
  EXCHANGE_INSPECTION_TICKET_TEMPLATE_BOTH_FAILED:
    'EXCHANGE_INSPECTION_TICKET_TEMPLATE_BOTH_FAILED',
  EXCHANGE_INSPECTION_TICKET_TEMPLATE_OWN_FAILED:
    'EXCHANGE_INSPECTION_TICKET_TEMPLATE_OWN_FAILED',
  EXCHANGE_INSPECTION_TICKET_TEMPLATE_OTHER_FAILED:
    'EXCHANGE_INSPECTION_TICKET_TEMPLATE_OTHER_FAILED',
  ACTION_DEADLINE_REMINDER_DEFAULT_MINUTES:
    'ACTION_DEADLINE_REMINDER_DEFAULT_MINUTES',
  ACTION_DEADLINE_REMINDER_EXCHANGE_PAYMENT_MINUTES:
    'ACTION_DEADLINE_REMINDER_EXCHANGE_PAYMENT_MINUTES',
  ACTION_DEADLINE_REMINDER_EXCHANGE_SHIPMENT_MINUTES:
    'ACTION_DEADLINE_REMINDER_EXCHANGE_SHIPMENT_MINUTES',
  ACTION_DEADLINE_REMINDER_ORDER_SELLER_SHIPMENT_MINUTES:
    'ACTION_DEADLINE_REMINDER_ORDER_SELLER_SHIPMENT_MINUTES',
  ACTION_DEADLINE_REMINDER_AUCTION_PAYMENT_MINUTES:
    'ACTION_DEADLINE_REMINDER_AUCTION_PAYMENT_MINUTES',
  /** شناسه پلن فعال‌شونده برای کاربران تازه‌ثبت‌نام (خالی = فقط سهمیه رایگان) */
  DEFAULT_REGISTRATION_PLAN_ID: 'DEFAULT_REGISTRATION_PLAN_ID',
  /** شناسه پلن هدیه پس از تایید احراز هویت (خالی = بدون تغییر پلن) */
  KYC_APPROVAL_PLAN_ID: 'KYC_APPROVAL_PLAN_ID',
  /** فعال‌سازی ثبت آگهی با ورود موبایل بدون احراز کامل */
  KYC_ALLOW_LISTING_WITH_MOBILE: 'KYC_ALLOW_LISTING_WITH_MOBILE',
  /** سقف تعداد آگهی فعال/درانتظار برای کاربر بدون احراز هویت کامل */
  KYC_UNVERIFIED_LISTING_LIMIT: 'KYC_UNVERIFIED_LISTING_LIMIT',
  KYC_UNVERIFIED_MAX_AMOUNT: 'KYC_UNVERIFIED_MAX_AMOUNT',
  /** دسترسی سفارش‌ها (خرید/فروش/درخواست‌ها) نیازمند احراز هویت کاربری */
  KYC_REQUIRE_IDENTITY_FOR_ORDERS: 'KYC_REQUIRE_IDENTITY_FOR_ORDERS',
  /** دسترسی کیف پول نیازمند احراز مالی */
  KYC_REQUIRE_FINANCIAL_FOR_WALLET: 'KYC_REQUIRE_FINANCIAL_FOR_WALLET',
  /** ثبت برداشت/تسویه نیازمند احراز مالی */
  KYC_REQUIRE_FINANCIAL_FOR_WITHDRAW: 'KYC_REQUIRE_FINANCIAL_FOR_WITHDRAW',
  INQUIRY_MAX_PER_MINUTE: 'INQUIRY_MAX_PER_MINUTE',
  INQUIRY_MAX_PER_DAY: 'INQUIRY_MAX_PER_DAY',
  INQUIRY_MAX_PAYLOAD_CHANGES: 'INQUIRY_MAX_PAYLOAD_CHANGES',
  INQUIRY_MAX_FAILURES_BEFORE_MANUAL: 'INQUIRY_MAX_FAILURES_BEFORE_MANUAL',
  KYC_MANUAL_ENTRY_ENABLED: 'KYC_MANUAL_ENTRY_ENABLED',
  MAX_BANK_ACCOUNTS: 'MAX_BANK_ACCOUNTS',
  WITHDRAW_SHABA_REQUIRED_ABOVE_AMOUNT: 'WITHDRAW_SHABA_REQUIRED_ABOVE_AMOUNT',
  FINANCIAL_INQUIRY_PREFER: 'FINANCIAL_INQUIRY_PREFER',
  /** درصد پاداش معرف از کارمزد فروش دعوت‌شده (۰–۱۰۰) */
  REFERRAL_COMMISSION_PERCENT: 'REFERRAL_COMMISSION_PERCENT',
  /** متن پیش‌فرض اشتراک‌گذاری دعوت؛ {inviteCode} و {inviteLink} */
  REFERRAL_SHARE_MESSAGE: 'REFERRAL_SHARE_MESSAGE',
  /** پیشوند URL صفحات لندینگ (مثلاً p → /p/my-page). seller همیشه /seller */
  LANDING_PAGES_URL_PREFIX: 'LANDING_PAGES_URL_PREFIX',
  /** پیشوند URL لینک‌های ردیابی کمپین (مثلاً ref → /ref/my-slug) */
  CAMPAIGN_LINK_URL_PREFIX: 'CAMPAIGN_LINK_URL_PREFIX',
  TICKET_ATTACHMENT_ALLOWED_MIME_TYPES: 'TICKET_ATTACHMENT_ALLOWED_MIME_TYPES',
  TICKET_ATTACHMENT_MAX_SIZE_MB: 'TICKET_ATTACHMENT_MAX_SIZE_MB',
  TELEGRAM_BOT_ENABLED: 'TELEGRAM_BOT_ENABLED',
  TELEGRAM_BOT_TOKEN: 'TELEGRAM_BOT_TOKEN',
  /** یوزرنیم ربات (بدون @) برای ساخت لینک مستقیم t.me */
  TELEGRAM_BOT_USERNAME: 'TELEGRAM_BOT_USERNAME',
  /** متن پاسخ وقتی ربات غیرفعال است */
  TELEGRAM_BOT_DISABLED_MESSAGE: 'TELEGRAM_BOT_DISABLED_MESSAGE',
  TELEGRAM_PROXY_URL: 'TELEGRAM_PROXY_URL',
  /** لیست پروکسی‌ها (JSON array یا چندخطی). اگر مقدار داشته باشد، اولویت با این است. */
  TELEGRAM_PROXY_POOL: 'TELEGRAM_PROXY_POOL',
  /** بازه Health-check پروکسی‌ها (ثانیه). */
  TELEGRAM_PROXY_HEALTHCHECK_INTERVAL_SECONDS:
    'TELEGRAM_PROXY_HEALTHCHECK_INTERVAL_SECONDS',
  ZOHAL_IDENTITY_ENABLED: 'ZOHAL_IDENTITY_ENABLED',
  ZOHAL_POSTAL_ENABLED: 'ZOHAL_POSTAL_ENABLED',
  ZOHAL_CARD_MATCH_ENABLED: 'ZOHAL_CARD_MATCH_ENABLED',
  ZOHAL_IDENTITY_MAX_FAILURES: 'ZOHAL_IDENTITY_MAX_FAILURES',
  ZOHAL_CARD_MATCH_MAX_FAILURES: 'ZOHAL_CARD_MATCH_MAX_FAILURES',
  ZOHAL_IDENTITY_FAILURE_COUNT: 'ZOHAL_IDENTITY_FAILURE_COUNT',
  ZOHAL_CARD_MATCH_FAILURE_COUNT: 'ZOHAL_CARD_MATCH_FAILURE_COUNT',
} as const;

/**
 * متن پیش‌فرض گواهی کارشناسی. ادمین می‌تواند از پنل ادیت کند.
 * Placeholderهای پشتیبانی‌شده توسط InspectionCertificateService جایگزین می‌شوند.
 */
export const DEFAULT_INSPECTION_CERTIFICATE_TITLE = 'گواهی کارشناسی کالا';
export const DEFAULT_INSPECTION_CERTIFICATE_BODY = `بدینوسیله گواهی می‌شود کالای «{{itemTitle}}» در دستهٔ {{categoryTitle}} با وضعیت {{itemCondition}} متعلق به {{ownerName}} با شناسه ملی {{ownerNationalCode}} توسط کارشناسان مرکز پردازش طبقه در تاریخ {{verifiedDate}} از نظر فنی بررسی و مطابق مشخصات اعلامی تأیید شد.

شمارهٔ این سند {{certificateNumber}} است و پیگیری سفارش با شناسه {{orderIdShort}} در سامانه طبقه ثبت شده است. این گواهی صرفاً برای تأیید کارشناسی فنی کالا و اطلاعات همین سفارش صادر شده است.`;
export const DEFAULT_INSPECTION_CERTIFICATE_FOOTER = `مرکز پردازش و کارشناسی طبقه
آدرس: {{platformAddress}}
تلفن پشتیبانی: {{supportPhone}}`;

export type SettingKey = keyof typeof SETTING_KEYS;

const KNOWN_DESCRIPTIONS: Record<string, string> = {
  HOMEPAGE_BANNER: 'نام فایل تصویر بنر بالای صفحه اصلی',
  HOMEPAGE_LAYOUT: 'پیکربندی JSON بخش‌های صفحه اصلی (Hero، اسلایدرها، دسته‌ها)',
  MEDIA_FALLBACK_LOGO: 'لوگوی جایگزین وقتی تصویر آگهی/بندانگشتی لود نمی‌شود',
  USER_APP_LOGO_LIGHT: 'لوگوی رابط کاربر — تم روشن',
  USER_APP_LOGO_DARK: 'لوگوی رابط کاربر — تم تاریک',
  USER_APP_LOGO: 'لوگوی سمت کاربر (قدیمی؛ در صورت خالی بودن LIGHT/DARK استفاده می‌شود)',
  PWA_APP_NAME: 'نام نمایشی اپ / PWA (Add to Home Screen)',
  PWA_APP_SHORT_NAME: 'نام کوتاه اپ زیر آیکن',
  PWA_APP_ICON: 'آیکن نصب اپ — لوگوی روشن روی پس‌زمینه سفید',
  PWA_APP_FAVICON: 'favicon تب مرورگر — لوگوی تیره، پس‌زمینه شفاف',
  ADMIN_PANEL_LOGO: 'لوگوی پنل مدیریت',
  CRITICAL_ALERT_ENABLED: 'وضعیت نمایش اعلان بحرانی سراسری (true/false)',
  CRITICAL_ALERT_LABEL: 'متن لیبل اعلان بحرانی سراسری',
  CRITICAL_ALERT_TEXT: 'متن اعلان بحرانی سراسری',
  CRITICAL_ALERT_BG_COLOR: 'رنگ پس‌زمینه اعلان بحرانی (hex)',
  CRITICAL_ALERT_TEXT_COLOR: 'رنگ متن اعلان بحرانی (hex)',
  VERIFICATION_FEE: 'مبلغ کارشناسی پیش‌فرض (fallback) وقتی هیچ قانونی match نشود (تومان)',
  SHIPPING_COST: 'هزینه ارسال پیش‌فرض (تومان)',
  SELLER_SHIP_DEADLINE_MINUTES: 'مهلت ارسال فروشنده پس از پرداخت (دقیقه)',
  SELLER_RETURN_CONFIRM_DEADLINE_MINUTES:
    'مهلت تأیید دریافت مرجوعی توسط فروشنده؛ پس از شکایت و ثبت بازگشت کالا؛ در صورت تأخیر قطعی تأیید (دقیقه)',
  BUYER_CONFIRM_DEADLINE_MINUTES: 'مهلت تایید/شکایت خریدار پس از ارسال (دقیقه)',
  LISTING_DISPLAY_DAYS:
    'پس از تایید ادمین، آگهی چند روز روی سایت می‌ماند (۱ تا ۳۶۵). یک روز قبل از پایان به فروشنده اطلاع داده می‌شود؛ پس از اتمام آرشیو می‌شود.',
  LISTING_REVIEW_SLA_HOURS:
    'زمان تقریبی بررسی آگهی توسط ادمین که به فروشنده نشان داده می‌شود (ساعت، ۱ تا ۱۶۸)',
  LISTING_TYPE_DIRECT_ENABLED:
    'فعال بودن ثبت آگهی فروش مستقیم برای کاربران (true/false)',
  LISTING_TYPE_EXCHANGE_ENABLED:
    'فعال بودن ثبت آگهی معاوضه برای کاربران (true/false)',
  LISTING_TYPE_AUCTION_ENABLED:
    'فعال بودن ثبت آگهی مزایده برای کاربران (true/false)',
  PURCHASE_OFFER_VALIDITY_HOURS:
    'مهلت اعتبار پیشنهاد خرید برای تأیید فروشنده (ساعت)',
  PURCHASE_OFFER_CART_RESERVE_HOURS:
    'مهلت رزرو سبد پس از تأیید پیشنهاد خرید (ساعت)',
  EXCHANGE_NO_SHIPMENT_COMPENSATION:
    'درصد هزینه کارشناسی طرفی که ارسال نکرده: از سهم او کسر و به فرستنده جبران می‌شود (۰–۱۰۰)',
  AUCTION_WINNER_PAYMENT_DEADLINE_HOURS:
    'مهلت پرداخت برنده مزایده پس از پایان مزایده (ساعت)',
  AUCTION_SECOND_CHANCE_PAYMENT_DEADLINE_HOURS:
    'مهلت پرداخت نفر بعدی در صورت عدم پرداخت برنده (ساعت)',
  ORDER_COMPLETED_VIDEO_RETENTION_DAYS:
    'تعداد روز نگهداری ویدیوهای سفارش تکمیل‌شده قبل از حذف خودکار',
  POST_PURCHASE_SURVEY_ENABLED:
    'فعال بودن ارسال نظرسنجی پس از تکمیل معامله (true/false)',
  POST_PURCHASE_SURVEY_DELAY_HOURS:
    'چند ساعت بعد از تکمیل معامله لینک نظرسنجی ارسال شود (پیش‌فرض ۲۴)',
  POST_PURCHASE_SURVEY_EXPIRE_DAYS:
    'چند روز پس از ساخت، لینک نظرسنجی منقضی شود (پیش‌فرض ۳۰)',
  OTP_TTL_MINUTES: 'مدت اعتبار کد OTP (دقیقه)',
  DEFAULT_REGISTRATION_PLAN_ID:
    'شناسه پلن فعال‌شونده برای کاربران تازه‌ثبت‌نام (خالی = فقط سهمیه رایگان)',
  KYC_APPROVAL_PLAN_ID:
    'شناسه پلن هدیه پس از تایید احراز هویت (خالی = بدون تغییر پلن؛ در صورت تنظیم، پلن فعال قبلی لغو و این پلن فعال می‌شود)',
  KYC_ALLOW_LISTING_WITH_MOBILE:
    'اگر true باشد، کاربر با ورود موبایل می‌تواند آگهی ثبت کند (بدون نیاز به احراز کامل)',
  KYC_UNVERIFIED_LISTING_LIMIT:
    'سقف تعداد آگهی فعال/درانتظار برای کاربر بدون احراز کامل (عدد صحیح >= 0)',
  KYC_UNVERIFIED_MAX_AMOUNT:
    'سقف مبلغ آگهی فروش مستقیم برای کاربر بدون احراز کامل (تومان؛ ۰ = بدون سقف)',
  KYC_REQUIRE_IDENTITY_FOR_ORDERS:
    'اگر true باشد، دسترسی به خرید/فروش/درخواست‌ها فقط با احراز هویت کاربری فعال است',
  KYC_REQUIRE_FINANCIAL_FOR_WALLET:
    'اگر true باشد، عملیات واریز/برداشت کیف پول فقط با احراز مالی (تایید هویت + شبا + کارت بانکی) فعال است؛ مشاهده صفحه کیف پول محدود نمی‌شود',
  KYC_REQUIRE_FINANCIAL_FOR_WITHDRAW:
    'اگر true باشد، ثبت درخواست برداشت فقط با احراز مالی (تایید هویت + شبا یا کارت بانکی) فعال است',
  INQUIRY_MAX_PER_MINUTE:
    'حداکثر درخواست استعلام واقعی (تماس با Zohal) در هر دقیقه برای هر کاربر',
  INQUIRY_MAX_PER_DAY:
    'حداکثر درخواست استعلام واقعی در ۲۴ ساعت برای هر کاربر',
  INQUIRY_MAX_PAYLOAD_CHANGES:
    'حداکثر بار تغییر داده استعلام قبل از مسدود شدن خودکار کاربر',
  INQUIRY_MAX_FAILURES_BEFORE_MANUAL:
    'حداکثر خطای استعلام قبل از فعال شدن حالت ورود دستی',
  KYC_MANUAL_ENTRY_ENABLED:
    'اگر true باشد، پس از خطاهای متعدد امکان ورود دستی اطلاعات فعال می‌شود',
  MAX_BANK_ACCOUNTS:
    'حداکثر تعداد حساب بانکی فعال هر کاربر (برای افزودن بیشتر باید یکی را حذف کند)',
  WITHDRAW_SHABA_REQUIRED_ABOVE_AMOUNT:
    'مبلغ برداشت (تومان)؛ بالاتر از این سقف، حساب پیش‌فرض باید شبا داشته باشد (۰ = غیرفعال)',
  FINANCIAL_INQUIRY_PREFER:
    'وقتی کارت و شبا هر دو وارد شد: card یا iban — کدام استعلام Zohal انجام شود',
  REFERRAL_COMMISSION_PERCENT:
    'درصد پاداش معرف از کارمزد فروش کاربر دعوت‌شده (۰ تا ۱۰۰؛ فقط سطح اول)',
  REFERRAL_SHARE_MESSAGE:
    'متن پیش‌فرض دعوت دوستان؛ از {inviteCode} و {inviteLink} استفاده کنید',
  LANDING_PAGES_URL_PREFIX:
    'پیشوند URL صفحات لندینگ (فقط حروف کوچک انگلیسی و خط تیره؛ مثلاً p → /p/slug)',
  CAMPAIGN_LINK_URL_PREFIX:
    'پیشوند URL لینک‌های ردیابی کمپین (مثلاً ref → /ref/slug؛ ref همیشه برای سازگاری فعال می‌ماند)',
  OTP_RESEND_COOLDOWN_SECONDS:
    'حداقل فاصله بین دو درخواست OTP برای یک شماره (ثانیه)',
  TRADE_REPUTATION_SUCCESS_DELTA:
    'افزایش امتیاز اعتماد (۰–۵) پس از تکمیل موفق',
  TRADE_REPUTATION_PENALTY_DELTA:
    'کاهش امتیاز اعتماد (۰–۵) پس از شکست یا لغو معامله',
  EXCHANGE_PAYMENT_TRUST_PENALTY:
    'کسر امتیاز اعتماد (۰–۱۰۰) برای طرف مقصر در عدم پرداخت/تأخیر معاوضه',
  AUCTION_LAST_MINUTE_EXTENSION_MINUTES:
    'تمدید خودکار پایان مزایده وقتی پیشنهاد در N دقیقه آخر ثبت شود (دقیقه)',
  AUCTION_PAYMENT_DEADLINE_MINUTES:
    '@deprecated — از AUCTION_WINNER_PAYMENT_DEADLINE_HOURS استفاده کنید؛ فقط سازگاری',
  AUCTION_SECOND_CHANCE_DEADLINE_MINUTES:
    '@deprecated — از AUCTION_SECOND_CHANCE_PAYMENT_DEADLINE_HOURS استفاده کنید',
  ACTION_DEADLINE_REMINDER_DEFAULT_MINUTES:
    'پیش‌فرض یادآوری مهلت: اگر برای هر نوع اقدام مقدار جدا خالی باشد، وقتی کمتر از این دقیقه به پایان مهلت مانده نوتیف ارسال می‌شود',
  ACTION_DEADLINE_REMINDER_EXCHANGE_PAYMENT_MINUTES:
    'یادآوری پرداخت معاوضه: ارسال نوتیف وقتی کمتر از این دقیقه به پایان مهلت پرداخت مانده',
  ACTION_DEADLINE_REMINDER_EXCHANGE_SHIPMENT_MINUTES:
    'یادآوری ارسال معاوضه: ارسال نوتیف وقتی کمتر از این دقیقه به پایان مهلت ارسال به هاب مانده',
  ACTION_DEADLINE_REMINDER_ORDER_SELLER_SHIPMENT_MINUTES:
    'یادآوری ارسال فروشنده (خرید/مزایده): ارسال نوتیف وقتی کمتر از این دقیقه به پایان مهلت ثبت رهگیری مانده',
  ACTION_DEADLINE_REMINDER_AUCTION_PAYMENT_MINUTES:
    'یادآوری پرداخت مزایده: ارسال نوتیف وقتی کمتر از این دقیقه به پایان مهلت پرداخت برنده مانده',
  PLATFORM_ADDRESS: 'آدرس دفتر / هاب طبقه',
  PLATFORM_ADDRESSES: 'لیست آدرس‌های هاب طبقه با کد پستی (JSON)',
  SUPPORT_PHONE: 'شماره پشتیبانی',
  SUPPORT_EMAIL: 'ایمیل پشتیبانی',
  TICKET_ATTACHMENT_ALLOWED_MIME_TYPES:
    'فرمت‌های مجاز پیوست تیکت پشتیبانی (JSON آرایه MIME type)',
  TICKET_ATTACHMENT_MAX_SIZE_MB: 'حداکثر حجم پیوست تیکت پشتیبانی (مگابایت)',
  TELEGRAM_BOT_ENABLED: 'فعال/غیرفعال بودن تلگرام بات (true/false)',
  TELEGRAM_BOT_TOKEN: 'توکن تلگرام بات (BotFather token)',
  TELEGRAM_BOT_USERNAME:
    'یوزرنیم ربات برای ساخت لینک مستقیم (مثلاً tabagheh_bot بدون @)',
  TELEGRAM_BOT_DISABLED_MESSAGE:
    'متن پاسخ ربات وقتی غیرفعال است (به همه پیام‌ها همین را جواب می‌دهد)',
  TELEGRAM_PROXY_URL:
    'آدرس پراکسی برای Telegram Bot API (مثلاً http://user:pass@ip:port یا socks5://...)',
  TELEGRAM_PROXY_POOL:
    'لیست پروکسی‌های قابل استفاده برای بات (JSON array یا متن چندخطی؛ هر خط یک URL). اولویت با این لیست است.',
  TELEGRAM_PROXY_HEALTHCHECK_INTERVAL_SECONDS:
    'بازه بررسی سلامت پروکسی‌ها برای بات (ثانیه). پیش‌فرض: 10',
  ZOHAL_IDENTITY_ENABLED:
    'فعال بودن احراز هویت خودکار (شاهکار + ثبت احوال) — true/false',
  ZOHAL_POSTAL_ENABLED:
    'فعال بودن استعلام کد پستی — true/false',
  ZOHAL_CARD_MATCH_ENABLED:
    'فعال بودن تطبیق کارت بانکی با کد ملی هنگام برداشت — true/false',
  ZOHAL_IDENTITY_MAX_FAILURES:
    'آستانه خطای سراسری احراز هویت؛ پس از آن fallback به فرم دستی',
  ZOHAL_CARD_MATCH_MAX_FAILURES:
    'آستانه خطای سراسری تطبیق کارت؛ پس از آن برداشت بدون استعلام خودکار',
  ZOHAL_IDENTITY_FAILURE_COUNT:
    'شمارنده runtime خطاهای احراز هویت (ادمین می‌تواند reset کند)',
  ZOHAL_CARD_MATCH_FAILURE_COUNT:
    'شمارنده runtime خطاهای تطبیق کارت (ادمین می‌تواند reset کند)',
  BANK_CARD_NUMBER: 'شماره کارت بانکی واریز',
  BANK_ACCOUNT_HOLDER: 'نام دارنده حساب بانکی',
  BANK_SHABA: 'شماره شبا جهت واریز',
  MANUAL_CARD_TRANSFER_MAX: 'حداکثر مبلغ مجاز کارت‌به‌کارت (تومان)',
  TERMS_CONDITIONS: 'متن قوانین و مقررات (نمایش به کاربران)',
  TERMS_VERSION: 'نسخه قوانین؛ با تغییر آن کاربران باید دوباره بپذیرند',
  PRIVACY_POLICY: 'متن حریم خصوصی (نمایش در /privacy)',
  SELLER_TERMS: 'قرارداد فروشنده هنگام ارسال آگهی',
  ABOUT_US: 'متن صفحه درباره ما',
  FOOTER_TAGLINE: 'معرفی کوتاه فوتر سایت (۱–۲ جمله)',
  ENAMAD_ID: 'شناسه اینماد (پارامتر id در کد نماد اعتماد)',
  ENAMAD_CODE: 'کد اینماد (پارامتر Code در کد نماد اعتماد)',
  ENAMAD_ENABLED: 'نمایش نماد اعتماد الکترونیکی در فوتر سایت',
  SITE_LICENSES_JSON:
    'مجوزها و نمادهای فوتر (JSON: enamad یا image+link)',
  PAYMENT_GATEWAYS_JSON:
    'لیست درگاه‌های پرداخت (JSON: id, type, label, enabled, sortOrder)',
  HEADER_NAV_JSON:
    'منوی هدر سایت (JSON آرایه آیتم‌ها با label/link/enabled)',
  HEADER_ACTIONS_JSON:
    'اکشن‌های هدر: آیکن سبد، نمایش CTA و ... (JSON)',
  FOOTER_TEXTS_JSON: 'متن‌های فوتر: باشگاه، عناوین بخش‌ها، کپی‌رایت (JSON)',
  FOOTER_QUICK_LINKS_JSON:
    'لینک‌های دسترسی سریع فوتر (JSON آرایه با label/link/icon/enabled)',
  REPAIR_ALLOWED_CATEGORY_IDS:
    'لیست دسته‌بندی‌های مجاز برای ثبت تعمیرات (JSON)',
  PLATFORM_LATITUDE: 'مختصات جغرافیایی عرض (Latitude) مرکز طبقه',
  PLATFORM_LONGITUDE: 'مختصات جغرافیایی طول (Longitude) مرکز طبقه',
  SMS_NOTIFICATION_RULES: 'پالیسی نوتیف/پیامک به ازای نوع رویداد (JSON)',
  ACTIVE_SMS_PROVIDER:
    'پرووایدر پیش‌فرض ارسال SMS: smsir یا kavenegar',
  SMS_OTP_SMS_PROVIDER:
    'پرووایدر SMS ورود (OTP): خالی/default = پیش‌فرض سراسری',
  SMS_OTP_TEMPLATE_ID: 'شناسه قالب پیامک ورود (OTP) در sms.ir',
  SMS_OTP_TEMPLATE_NAME: 'نام الگوی پیامک ورود (OTP) در کاوه‌نگار',
  SMS_OTP_CODE_PARAMETER_NAME:
    'نام پارامتر قالب OTP که مقدار کد در آن قرار می‌گیرد (مثلاً CONTACTS)',
  SMS_WITHDRAW_OTP_TEMPLATE_ID:
    'شناسه قالب پیامک OTP تأیید برداشت کیف پول در sms.ir',
  SMS_WITHDRAW_OTP_SMS_PROVIDER:
    'پرووایدر SMS OTP برداشت: خالی/default = پیش‌فرض سراسری',
  SMS_WITHDRAW_OTP_TEMPLATE_NAME:
    'نام الگوی پیامک OTP تأیید برداشت کیف پول در کاوه‌نگار',
  SMS_WITHDRAW_OTP_CODE_PARAMETER_NAME:
    'نام پارامتر قالب OTP برداشت که مقدار کد در آن قرار می‌گیرد',
  SMS_ADMIN_LOGIN_ALERT_ENABLED:
    'ارسال پیامک به ادمین پس از ورود کاربر (true/false، پیش‌فرض true)',
  SMS_ADMIN_LOGIN_ALERT_TEMPLATE_ID:
    'شناسه قالب پیامک «ورود کاربر» برای اطلاع ادمین در sms.ir',
  SMS_ADMIN_LOGIN_ALERT_SMS_PROVIDER:
    'پرووایدر SMS هشدار ورود ادمین: خالی/default = پیش‌فرض سراسری',
  SMS_ADMIN_LOGIN_ALERT_TEMPLATE_NAME:
    'نام الگوی پیامک «ورود کاربر» برای اطلاع ادمین در کاوه‌نگار',
  SMS_ADMIN_LOGIN_ALERT_RECIPIENTS:
    'شماره‌های ادمین برای دریافت هشدار ورود (جدا با ویرگول، مثلاً 0912...,0913...)',
  SMS_ADMIN_LOGIN_ALERT_USER_PHONE_PARAMETER:
    'نام پارامتر قالب هشدار ورود که شمارهٔ کاربر واردشده در آن قرار می‌گیرد (مثلاً PHONE)',
  SMS_DEPLOY_ALERT_ENABLED:
    'ارسال پیامک نتیجه دیپلوی به ادمین (true/false یا 1/0، پیش‌فرض true)',
  SMS_DEPLOY_ALERT_RECIPIENTS:
    'شماره‌های ادمین برای دریافت نتیجه دیپلوی (جدا با ویرگول؛ در نبود، از گیرندگان هشدار ورود استفاده می‌شود)',
  SMS_DEPLOY_ALERT_TEMPLATE_ID:
    'شناسه قالب پیامک نتیجه دیپلوی در sms.ir (با پارامترهای #STATUS و #DETAIL)',
  SMS_DEPLOY_ALERT_TEMPLATE_NAME:
    'نام الگوی Lookup نتیجه دیپلوی در کاوه‌نگار (token=STATUS، token2=DETAIL)',
  SMS_DEPLOY_ALERT_STATUS_PARAMETER:
    'نام پارامتر وضعیت در قالب دیپلوی (پیش‌فرض STATUS)',
  SMS_DEPLOY_ALERT_DETAIL_PARAMETER:
    'نام پارامتر جزئیات در قالب دیپلوی (پیش‌فرض DETAIL؛ خالی = فقط STATUS)',
  SMS_UPTIME_ALERT_ENABLED:
    'ارسال پیامک قطع/وصل دسترس‌پذیری سامانه (true/false، پیش‌فرض true؛ اسکریپت cron روی سرور)',
  SMS_UPTIME_ALERT_RECIPIENTS:
    'شماره‌های ادمین برای هشدار قطع/وصل (جدا با ویرگول؛ در نبود، از گیرندگان دیپلوی/ورود استفاده می‌شود)',
  SMS_UPTIME_ALERT_TEMPLATE_ID:
    'شناسه قالب پیامک مانیتور در sms.ir (جدا از دیپلوی؛ با #STATUS و #DETAIL)',
  SMS_UPTIME_ALERT_TEMPLATE_NAME:
    'نام الگوی Lookup مانیتور در کاوه‌نگار (token=STATUS، token2=DETAIL)',
  SMS_UPTIME_ALERT_STATUS_PARAMETER:
    'نام پارامتر وضعیت در قالب مانیتور (پیش‌فرض STATUS)',
  SMS_UPTIME_ALERT_DETAIL_PARAMETER:
    'نام پارامتر جزئیات در قالب مانیتور (پیش‌فرض DETAIL)',
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
    'متن اصلی گواهی کارشناسی؛ از placeholderهایی مثل {{ownerName}}, {{itemTitle}}, {{orderIdShort}}, {{certificateNumber}}, {{verifiedDate}} پشتیبانی می‌کند',
  INSPECTION_CERTIFICATE_FOOTER:
    'پاورقی گواهی کارشناسی (نام مرکز، آدرس، تلفن پشتیبانی)',
  INSPECTION_CERTIFICATE_LOGO: 'فایل لوگوی بالای گواهی کارشناسی PDF',
  INSPECTION_CERTIFICATE_STAMP: 'فایل تصویر مهر/امضای پایین گواهی کارشناسی PDF',
  EXCHANGE_INSPECTION_TICKET_TEMPLATE_BOTH_FAILED:
    'قالب تیکت معاوضه (رد دوطرفه). متغیرها: {{orderShortId}}, {{listingTitle}}, {{refundAmount}}, {{penaltyDelta}}, {{ownNote}}',
  EXCHANGE_INSPECTION_TICKET_TEMPLATE_OWN_FAILED:
    'قالب تیکت معاوضه (رد کالای خود کاربر). متغیرها: {{orderShortId}}, {{listingTitle}}, {{refundAmount}}, {{penaltyDelta}}, {{ownNote}}',
  EXCHANGE_INSPECTION_TICKET_TEMPLATE_OTHER_FAILED:
    'قالب تیکت معاوضه (رد کالای طرف مقابل). متغیرها: {{orderShortId}}, {{listingTitle}}, {{refundAmount}}, {{penaltyDelta}}, {{ownNote}}',
};

const PWA_BRAND_CACHE_KEYS = new Set<string>([
  SETTING_KEYS.USER_APP_LOGO,
  SETTING_KEYS.USER_APP_LOGO_LIGHT,
  SETTING_KEYS.USER_APP_LOGO_DARK,
  SETTING_KEYS.PWA_APP_ICON,
  SETTING_KEYS.PWA_APP_FAVICON,
]);

@Injectable()
export class AdminSettingsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly pwaIconService: PwaIconService,
    private readonly listingExpiry: ListingExpiryService,
    private readonly appSettings: AppSettingsService,
    private readonly cache: TtlCacheService,
  ) {}

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
      if (key === SETTING_KEYS.AUCTION_WINNER_PAYMENT_DEADLINE_HOURS) {
        const hours = byKey.get(key)?.value?.trim();
        if (hours) {
          result[key] = hours;
          continue;
        }
        const legacyMinutes = Number(
          byKey.get(SETTING_KEYS.AUCTION_PAYMENT_DEADLINE_MINUTES)?.value ?? '',
        );
        result[key] =
          Number.isFinite(legacyMinutes) && legacyMinutes > 0
            ? String(Math.max(1, Math.round(legacyMinutes / 60)))
            : '';
        continue;
      }
      if (key === SETTING_KEYS.AUCTION_SECOND_CHANCE_PAYMENT_DEADLINE_HOURS) {
        const hours = byKey.get(key)?.value?.trim();
        if (hours) {
          result[key] = hours;
          continue;
        }
        const legacyMinutes = Number(
          byKey.get(SETTING_KEYS.AUCTION_SECOND_CHANCE_DEADLINE_MINUTES)?.value ??
            '',
        );
        result[key] =
          Number.isFinite(legacyMinutes) && legacyMinutes > 0
            ? String(Math.max(1, Math.round(legacyMinutes / 60)))
            : '';
        continue;
      }
      result[key] = byKey.get(key)?.value ?? '';
    }
    result.ACTIVE_SMS_PROVIDER =
      byKey.get(SETTING_KEYS.ACTIVE_SMS_PROVIDER)?.value?.trim() ||
      this.appSettings.getActiveSmsProvider();
    if (!String(result.ENAMAD_ENABLED ?? '').trim()) {
      result.ENAMAD_ENABLED = 'true';
    }
    // Same effective list as runtime/checkout: DB JSON, else env ACTIVE_PAYMENT_GATEWAY.
    const gatewaysFromDb = parsePaymentGatewaysJson(
      result.PAYMENT_GATEWAYS_JSON,
    );
    result.PAYMENT_GATEWAYS_JSON = serializePaymentGatewaysJson(
      gatewaysFromDb.length > 0
        ? gatewaysFromDb
        : await this.appSettings.getPaymentGateways(),
    );
    const migratedLicenses = migrateEnamadToLicenses({
      licensesJson: String(result.SITE_LICENSES_JSON ?? ''),
      enamadId: String(result.ENAMAD_ID ?? ''),
      enamadCode: String(result.ENAMAD_CODE ?? ''),
      enamadEnabled: String(result.ENAMAD_ENABLED ?? ''),
    });
    result.SITE_LICENSES_JSON = serializeSiteLicensesJson(migratedLicenses);
    return result;
  }

  async upsert(dto: UpsertSettingDto, actor?: AuthenticatedUser) {
    this.assertValidSettingValue(dto.key, dto.value);
    const existing = await this.prisma.systemSetting.findUnique({
      where: { key: dto.key },
      select: { value: true },
    });
    const description = dto.description ?? KNOWN_DESCRIPTIONS[dto.key] ?? null;
    const row = await this.writeSettingRow(dto.key, dto.value, description);
    if (existing?.value !== dto.value) {
      this.logSettingChange(actor, dto.key, existing?.value ?? null, dto.value);
    }
    if (dto.key === SETTING_KEYS.LISTING_DISPLAY_DAYS) {
      await this.listingExpiry.recalculateApprovedListingExpiry();
    }
    await this.invalidatePublicSiteSettingsCache();
    return row;
  }

  async upsertMany(dto: BulkUpsertSettingsDto, actor?: AuthenticatedUser) {
    const items = this.uniqueSettingItems(this.expandLegacySyncItems(dto.items));
    for (const item of items) {
      this.assertValidSettingValue(item.key, item.value);
    }
    const keys = items.map((i) => i.key);
    const existingRows = await this.prisma.systemSetting.findMany({
      where: { key: { in: keys } },
      select: { key: true, value: true },
    });
    const oldByKey = new Map(existingRows.map((r) => [r.key, r.value]));

    const result = await this.prisma.$transaction(
      items.map((item) => {
        const description =
          item.description ?? KNOWN_DESCRIPTIONS[item.key] ?? null;
        return this.prisma.systemSetting.upsert({
          where: { key: item.key },
          update: { value: item.value, description },
          create: { key: item.key, value: item.value, description },
        });
      }),
    );

    for (const item of items) {
      const prev = oldByKey.get(item.key);
      if (prev !== item.value) {
        this.logSettingChange(actor, item.key, prev ?? null, item.value);
      }
    }

    if (items.some((item) => item.key === SETTING_KEYS.LISTING_DISPLAY_DAYS)) {
      await this.listingExpiry.recalculateApprovedListingExpiry();
    }

    await this.invalidatePublicSiteSettingsCache();

    return result;
  }

  private async invalidatePublicSiteSettingsCache(): Promise<void> {
    await Promise.all([
      this.cache.delete('common:site-settings'),
      this.cache.delete('common:homepage-layout'),
    ]);
  }

  private assertValidSettingValue(key: string, value: string): void {
    const normalized = value.trim().toLowerCase();
    if (key === SETTING_KEYS.ACTIVE_SMS_PROVIDER) {
      if (normalized !== 'smsir' && normalized !== 'kavenegar') {
        throw new BadRequestException(
          'پرووایدر SMS باید smsir یا kavenegar باشد',
        );
      }
      return;
    }
    if (
      key === SETTING_KEYS.SMS_OTP_SMS_PROVIDER ||
      key === SETTING_KEYS.SMS_WITHDRAW_OTP_SMS_PROVIDER ||
      key === SETTING_KEYS.SMS_ADMIN_LOGIN_ALERT_SMS_PROVIDER
    ) {
      if (!normalized || normalized === 'default') return;
      if (normalized !== 'smsir' && normalized !== 'kavenegar') {
        throw new BadRequestException(
          'پرووایدر SMS باید خالی، default، smsir یا kavenegar باشد',
        );
      }
      return;
    }
    if (key === SETTING_KEYS.ENAMAD_ENABLED) {
      if (normalized !== 'true' && normalized !== 'false' && normalized !== '') {
        throw new BadRequestException(
          'ENAMAD_ENABLED باید true یا false باشد',
        );
      }
      return;
    }
    if (key === SETTING_KEYS.PAYMENT_GATEWAYS_JSON) {
      try {
        validatePaymentGatewaysJson(value);
      } catch (err) {
        throw new BadRequestException(
          err instanceof Error ? err.message : 'پیکربندی درگاه نامعتبر است',
        );
      }
      return;
    }
    if (key === SETTING_KEYS.SITE_LICENSES_JSON) {
      try {
        validateSiteLicensesJson(value);
      } catch (err) {
        throw new BadRequestException(
          err instanceof Error ? err.message : 'پیکربندی مجوزها نامعتبر است',
        );
      }
    }
  }

  getPaymentGatewayCatalog() {
    return PAYMENT_GATEWAY_CATALOG;
  }

  async getPaymentGatewaysConfig() {
    return {
      catalog: PAYMENT_GATEWAY_CATALOG,
      gateways: await this.appSettings.getPaymentGateways(),
    };
  }

  saveLicenseIcon(filename: string) {
    return { filename, ok: true as const };
  }

  parseEnamadEmbed(html: string) {
    const parsed = parseEnamadTag(html);
    if (!parsed) {
      throw new BadRequestException(
        'تگ اینماد معتبر نیست — باید شامل id و Code باشد',
      );
    }
    return parsed;
  }

  private uniqueSettingItems(
    items: BulkUpsertSettingsDto['items'],
  ): BulkUpsertSettingsDto['items'] {
    const byKey = new Map<string, BulkUpsertSettingsDto['items'][number]>();
    for (const item of items) {
      byKey.set(item.key, item);
    }
    return [...byKey.values()];
  }

  private async writeSettingRow(
    key: string,
    value: string,
    description: string | null,
  ) {
    const existing = await this.prisma.systemSetting.findUnique({
      where: { key },
      select: { id: true },
    });
    if (existing) {
      return this.prisma.systemSetting.update({
        where: { key },
        data: { value, description },
      });
    }
    try {
      return await this.prisma.systemSetting.create({
        data: { key, value, description },
      });
    } catch (err) {
      if (
        err instanceof Prisma.PrismaClientKnownRequestError &&
        err.code === 'P2002'
      ) {
        return this.prisma.systemSetting.update({
          where: { key },
          data: { value, description },
        });
      }
      throw err;
    }
  }

  private expandLegacySyncItems(
    items: BulkUpsertSettingsDto['items'],
  ): BulkUpsertSettingsDto['items'] {
    const out = [...items];
    const pushIfMissing = (key: string, value: string) => {
      if (!out.some((i) => i.key === key)) {
        out.push({ key, value });
      }
    };

    for (const item of items) {
      if (item.key === SETTING_KEYS.AUCTION_WINNER_PAYMENT_DEADLINE_HOURS) {
        const hours = Number(item.value);
        if (Number.isFinite(hours) && hours > 0) {
          pushIfMissing(
            SETTING_KEYS.AUCTION_PAYMENT_DEADLINE_MINUTES,
            String(Math.floor(hours * 60)),
          );
        }
      }
      if (item.key === SETTING_KEYS.AUCTION_SECOND_CHANCE_PAYMENT_DEADLINE_HOURS) {
        const hours = Number(item.value);
        if (Number.isFinite(hours) && hours > 0) {
          pushIfMissing(
            SETTING_KEYS.AUCTION_SECOND_CHANCE_DEADLINE_MINUTES,
            String(Math.floor(hours * 60)),
          );
        }
      }
    }
    return out;
  }

  private logSettingChange(
    actor: AuthenticatedUser | undefined,
    key: string,
    previousValue: string | null,
    newValue: string,
  ): void {
    appendJsonLog('settings-audit.log', {
      at: new Date().toISOString(),
      actorId: actor?.id ?? null,
      actorRole: actor?.role ?? null,
      key,
      previousValue,
      newValue,
    });
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
        key === SETTING_KEYS.PWA_APP_ICON ||
        key === SETTING_KEYS.PWA_APP_FAVICON ||
        key === SETTING_KEYS.ADMIN_PANEL_LOGO) &&
      existing.value
    ) {
      this.deleteBrandLogoFile(existing.value);
    }

    await this.prisma.systemSetting.delete({ where: { key } });
    await this.invalidatePublicSiteSettingsCache();
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

  async setPwaAppIcon(filename: string) {
    if (!filename) throw new BadRequestException('فایل آیکن اپ نامعتبر است');
    return this.setBrandLogoByKey(SETTING_KEYS.PWA_APP_ICON, filename);
  }

  async removePwaAppIcon() {
    return this.clearBrandLogoByKey(SETTING_KEYS.PWA_APP_ICON);
  }

  async setPwaAppFavicon(filename: string) {
    if (!filename) throw new BadRequestException('فایل favicon نامعتبر است');
    return this.setBrandLogoByKey(SETTING_KEYS.PWA_APP_FAVICON, filename);
  }

  async removePwaAppFavicon() {
    return this.clearBrandLogoByKey(SETTING_KEYS.PWA_APP_FAVICON);
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
      const stillUsed = await this.isBrandFilenameInUse(previous.value, key);
      if (!stillUsed) this.deleteBrandLogoFile(previous.value);
    }

    const result = await this.upsert({
      key,
      value: filename,
      description: KNOWN_DESCRIPTIONS[key],
    });
    this.invalidatePwaIconsIfUserLogo(key);
    return result;
  }

  private async isBrandFilenameInUse(
    filename: string,
    exceptKey?: string,
  ): Promise<boolean> {
    const safeName = filename.split(/[\\/]/).pop();
    if (!safeName) return false;
    const brandKeys = [
      SETTING_KEYS.MEDIA_FALLBACK_LOGO,
      SETTING_KEYS.USER_APP_LOGO,
      SETTING_KEYS.USER_APP_LOGO_LIGHT,
      SETTING_KEYS.USER_APP_LOGO_DARK,
      SETTING_KEYS.PWA_APP_ICON,
      SETTING_KEYS.PWA_APP_FAVICON,
      SETTING_KEYS.ADMIN_PANEL_LOGO,
    ].filter((k) => k !== exceptKey);
    const count = await this.prisma.systemSetting.count({
      where: {
        value: safeName,
        key: { in: brandKeys },
      },
    });
    return count > 0;
  }

  private async clearBrandLogoByKey(key: string) {
    const existing = await this.prisma.systemSetting.findUnique({
      where: { key },
    });
    if (existing?.value) {
      const stillUsed = await this.isBrandFilenameInUse(existing.value, key);
      if (!stillUsed) this.deleteBrandLogoFile(existing.value);
    }

    await this.prisma.systemSetting.upsert({
      where: { key },
      update: { value: '' },
      create: {
        key,
        value: '',
        description: KNOWN_DESCRIPTIONS[key] ?? null,
      },
    });
    this.invalidatePwaIconsIfUserLogo(key);
    return { ok: true };
  }

  private invalidatePwaIconsIfUserLogo(key: string): void {
    if (!PWA_BRAND_CACHE_KEYS.has(key)) return;
    this.pwaIconService.clearCache();
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

  async getHomepageLayout(): Promise<HomePageLayout> {
    const row = await this.prisma.systemSetting.findUnique({
      where: { key: SETTING_KEYS.HOMEPAGE_LAYOUT },
    });
    return mergeHomepageLayout(row?.value ?? null);
  }

  async upsertHomepageLayout(layout: HomePageLayout, actor?: AuthenticatedUser) {
    const err = validateHomepageLayout(layout);
    if (err) throw new BadRequestException(err);

    const value = JSON.stringify(layout);
    await this.upsert(
      {
        key: SETTING_KEYS.HOMEPAGE_LAYOUT,
        value,
        description: KNOWN_DESCRIPTIONS.HOMEPAGE_LAYOUT,
      },
      actor,
    );
    return mergeHomepageLayout(layout);
  }

  async resetHomepageLayout(actor?: AuthenticatedUser) {
    await this.prisma.systemSetting.deleteMany({
      where: { key: SETTING_KEYS.HOMEPAGE_LAYOUT },
    });
    await this.invalidatePublicSiteSettingsCache();
    return mergeHomepageLayout(null);
  }
}
