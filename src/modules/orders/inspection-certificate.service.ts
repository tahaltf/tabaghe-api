import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
  OnModuleDestroy,
} from '@nestjs/common';
import { existsSync, readFileSync } from 'fs';
import { extname, join } from 'path';
import type { Browser } from 'puppeteer';
import { OrderStatus, OrderType } from '@prisma/client';

import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import {
  DEFAULT_INSPECTION_CERTIFICATE_BODY,
  DEFAULT_INSPECTION_CERTIFICATE_FOOTER,
  DEFAULT_INSPECTION_CERTIFICATE_TITLE,
  SETTING_KEYS,
} from '../admin/services/admin-settings.service';
import { BRAND_LOGO_UPLOAD_PATH } from '../../common/upload/brand-logo-upload.config';
import { INSPECTION_CERTIFICATE_ASSET_UPLOAD_PATH } from '../../common/upload/inspection-certificate-asset-upload.config';
import {
  buildInspectionCertificateHtml,
  type CertificateThemePalette,
} from './inspection-certificate.template';
import { resolveCertificateFontFiles } from './inspection-certificate-fonts';
import {
  formatTomanAmountsInPlainText,
  maskOwnerNationalCodeForCertificate,
  sanitizeInspectionResultForCertificate,
} from './inspection-certificate-text.util';

/**
 * طرف کالای کارشناسی‌شده در سفارش معاوضه:
 * - LISTING: کالای فروشنده (صاحب آگهی)
 * - OFFER: کالای پیشنهاددهنده (خریدار/معاوضه‌کننده)
 * برای DIRECT/AUCTION این پارامتر معنا ندارد.
 */
export type InspectionCertificateSide = 'LISTING' | 'OFFER';

export interface InspectionCertificateGenerateOptions {
  orderId: string;
  /** کاربری که درخواست دانلود کرده — جهت بررسی دسترسی استفاده می‌شود */
  requesterUserId: string;
  /** برای سفارش معاوضه الزامی است؛ برای DIRECT/AUCTION نادیده گرفته می‌شود. */
  side?: InspectionCertificateSide;
}

interface CertificateContext {
  ownerName: string;
  ownerNationalCode: string;
  itemTitle: string;
  itemCondition: string;
  categoryTitle: string;
  /** شناسهٔ کوتاه‌شدهٔ سفارش برای نمایش در گواهی */
  orderIdShort: string;
  orderId: string;
  certificateNumber: string;
  verifiedDate: string;
  platformAddress: string;
  supportPhone: string;
  inspectionResult: string;
  /**
   * عمداً خالی — در قالب‌های قدیمی ادمین اگر {{trackingCode}} مانده باشد، چیزی در گواهی چاپ نمی‌شود.
   */
  trackingCode: string;
}

const DEFAULT_THEME_PALETTE: CertificateThemePalette = {
  primary: '#13324e',
  primaryLight: '#1e4b70',
  accent: '#ef684c',
  accentHover: '#d95236',
  surfaceLight: '#f1f5f9',
};

const THEME_PALETTE_SETTING_KEY = 'THEME_PALETTE';
/** نام پیش‌فرض وقتی شناسه آگهی در دسترس نیست */
export const INSPECTION_CERTIFICATE_DOWNLOAD_FILENAME =
  'کارشناسی طبقه.pdf';

export function buildInspectionCertificateDownloadFilename(
  listingId: string,
): string {
  const id = String(listingId ?? '').trim();
  if (!id) return INSPECTION_CERTIFICATE_DOWNLOAD_FILENAME;
  return `کارشناسی طبقه - ${id}.pdf`;
}

@Injectable()
export class InspectionCertificateService implements OnModuleDestroy {
  private readonly logger = new Logger(InspectionCertificateService.name);
  private browser: Browser | null = null;
  private browserPromise: Promise<Browser> | null = null;
  private fontFaceCssCache: string | null = null;

  constructor(private readonly prisma: PrismaService) {}

  async onModuleDestroy() {
    if (this.browser) {
      try {
        await this.browser.close();
      } catch {
        // ignore
      }
      this.browser = null;
    }
  }

  /**
   * تولید PDF گواهی کارشناسی برای صاحب کالا.
   * شرایط:
   *  - سفارش به وضعیت VERIFIED_AT_HUB یا بالاتر رسیده باشد.
   *  - requiresVerification=true باشد.
   *  - کاربر درخواست‌کننده، خریدار یا فروشنده سفارش باشد.
   *  - برای EXCHANGE: side ارسال شده باشد و کالای آن طرف در کارشناسی پاس شده باشد.
   */
  async generateInspectionCertificatePdf(
    options: InspectionCertificateGenerateOptions,
  ): Promise<{ pdf: Buffer; filename: string }> {
    const { orderId, requesterUserId, side } = options;

    const order = await this.prisma.order.findUnique({
      where: { id: orderId },
      include: {
        listing: {
          select: {
            id: true,
            title: true,
            condition: true,
            category: { select: { title: true } },
          },
        },
        buyer: {
          select: {
            id: true,
            firstName: true,
            lastName: true,
            nationalCode: true,
          },
        },
        seller: {
          select: {
            id: true,
            firstName: true,
            lastName: true,
            nationalCode: true,
          },
        },
      },
    });

    if (!order) throw new NotFoundException('سفارش یافت نشد');
    if (order.buyerId !== requesterUserId && order.sellerId !== requesterUserId)
      throw new ForbiddenException('شما به این گواهی دسترسی ندارید');

    if (!order.requiresVerification) {
      throw new BadRequestException(
        'برای این سفارش گواهی کارشناسی صادر نشده است (کارشناسی فنی درخواست نشده بود).',
      );
    }

    const verifiedStatuses: OrderStatus[] = [
      OrderStatus.VERIFIED_AT_HUB,
      OrderStatus.SHIPPED_TO_BUYER,
      OrderStatus.SHIPPED,
      OrderStatus.DELIVERED,
      OrderStatus.COMPLETED,
    ];
    if (!verifiedStatuses.includes(order.status)) {
      throw new BadRequestException(
        'هنوز نتیجه کارشناسی این سفارش صادر نشده است.',
      );
    }

    let resolvedSide: InspectionCertificateSide | null = null;
    let exchangeOffer: {
      title: string;
      description: string | null;
      offererId: string;
    } | null = null;
    if (order.type === OrderType.EXCHANGE) {
      if (!side) {
        throw new BadRequestException(
          'برای سفارش معاوضه باید مشخص کنید گواهی کدام کالا را می‌خواهید (LISTING یا OFFER).',
        );
      }
      resolvedSide = side;

      const inspection =
        (order.exchangeHubInspection as Record<string, unknown> | null) ?? null;
      if (inspection) {
        const key = side === 'LISTING' ? 'listingItem' : 'offerItem';
        const itemResult = inspection[key];
        const passCodes = new Set([
          'PASS',
          'OK',
          'VERIFIED',
          'PASS_WITH_SETTLEMENT',
        ]);
        if (itemResult && !passCodes.has(String(itemResult))) {
          throw new BadRequestException(
            'این کالا در کارشناسی تایید نشده و گواهی برای آن صادر نمی‌شود.',
          );
        }
      }

      if (side === 'OFFER' && order.exchangeOfferId) {
        exchangeOffer = await this.prisma.exchangeOffer.findUnique({
          where: { id: order.exchangeOfferId },
          select: { title: true, description: true, offererId: true },
        });
      }
    }

    const settings = await this.loadCertificateSettings();
    const context = this.buildCertificateContext(order, {
      side: resolvedSide,
      exchangeOffer,
      platformAddress: settings.platformAddress,
      supportPhone: settings.supportPhone,
    });

    const html = this.renderCertificateHtml({
      title: formatTomanAmountsInPlainText(
        this.applyPlaceholders(settings.title, context),
      ),
      body: formatTomanAmountsInPlainText(
        this.applyPlaceholders(settings.body, context),
      ),
      footer: formatTomanAmountsInPlainText(
        this.applyPlaceholders(settings.footer, context),
      ),
      logoDataUri: this.resolveCertificateLogoDataUri(
        settings.logoFilename,
        settings.userAppLogoFilename,
      ),
      stampDataUri: this.fileToDataUri(settings.stampFilename),
      context,
      palette: settings.palette,
      fontFamily: this.getCertificateFontFamily(),
    });

    const pdf = await this.renderHtmlToPdf(html);
    return {
      pdf,
      filename: buildInspectionCertificateDownloadFilename(order.listingId),
    };
  }

  // -------------------------------------------------------------------------
  // Settings + helpers
  // -------------------------------------------------------------------------

  private async loadCertificateSettings() {
    const keys = [
      SETTING_KEYS.INSPECTION_CERTIFICATE_TITLE,
      SETTING_KEYS.INSPECTION_CERTIFICATE_BODY,
      SETTING_KEYS.INSPECTION_CERTIFICATE_FOOTER,
      SETTING_KEYS.INSPECTION_CERTIFICATE_LOGO,
      SETTING_KEYS.INSPECTION_CERTIFICATE_STAMP,
      SETTING_KEYS.USER_APP_LOGO_LIGHT,
      SETTING_KEYS.USER_APP_LOGO_DARK,
      SETTING_KEYS.USER_APP_LOGO,
      SETTING_KEYS.PLATFORM_ADDRESS,
      SETTING_KEYS.SUPPORT_PHONE,
      THEME_PALETTE_SETTING_KEY,
    ];
    const rows = await this.prisma.systemSetting.findMany({
      where: { key: { in: keys } },
    });
    const map = new Map(rows.map((r) => [r.key, r.value]));
    return {
      palette: this.parseThemePalette(map.get(THEME_PALETTE_SETTING_KEY)),
      title:
        map.get(SETTING_KEYS.INSPECTION_CERTIFICATE_TITLE)?.trim() ||
        DEFAULT_INSPECTION_CERTIFICATE_TITLE,
      body:
        map.get(SETTING_KEYS.INSPECTION_CERTIFICATE_BODY) ||
        DEFAULT_INSPECTION_CERTIFICATE_BODY,
      footer:
        map.get(SETTING_KEYS.INSPECTION_CERTIFICATE_FOOTER) ||
        DEFAULT_INSPECTION_CERTIFICATE_FOOTER,
      logoFilename:
        map.get(SETTING_KEYS.INSPECTION_CERTIFICATE_LOGO)?.trim() || '',
      /** برای PDF تم روشن؛ در صورت خالی بودن از USER_APP_LOGO قدیمی استفاده می‌شود */
      userAppLogoFilename:
        map.get(SETTING_KEYS.USER_APP_LOGO_LIGHT)?.trim() ||
        map.get(SETTING_KEYS.USER_APP_LOGO)?.trim() ||
        '',
      stampFilename:
        map.get(SETTING_KEYS.INSPECTION_CERTIFICATE_STAMP)?.trim() || '',
      platformAddress: map.get(SETTING_KEYS.PLATFORM_ADDRESS)?.trim() || '',
      supportPhone: map.get(SETTING_KEYS.SUPPORT_PHONE)?.trim() || '',
    };
  }

  private buildCertificateContext(
    order: any,
    extras: {
      side: InspectionCertificateSide | null;
      exchangeOffer: {
        title: string;
        description: string | null;
        offererId: string;
      } | null;
      platformAddress: string;
      supportPhone: string;
    },
  ): CertificateContext {
    const { side, exchangeOffer, platformAddress, supportPhone } = extras;

    let owner: {
      firstName: string | null;
      lastName: string | null;
      nationalCode: string | null;
    };
    let itemTitle: string;
    const itemCondition: 'NEW' | 'USED' = order.listing?.condition ?? 'USED';
    let categoryTitle: string = order.listing?.category?.title ?? '—';

    if (order.type === OrderType.EXCHANGE && side === 'OFFER') {
      owner = order.buyer;
      itemTitle = exchangeOffer?.title || order.listing?.title || '—';
      categoryTitle = '—';
    } else {
      owner = order.seller;
      itemTitle = order.listing?.title || '—';
    }

    const ownerFullName =
      [owner?.firstName, owner?.lastName].filter(Boolean).join(' ').trim() ||
      'صاحب کالا';
    const ownerNationalCode = maskOwnerNationalCodeForCertificate(
      owner?.nationalCode || null,
    );

    const inspectionResultRaw = this.extractInspectionResultText(order, side);
    let inspectionResult = sanitizeInspectionResultForCertificate(
      inspectionResultRaw,
    );
    if (!inspectionResult) {
      inspectionResult =
        'سلامت فنی و مطابقت کالا با مشخصات اعلامی توسط کارشناسان طبقه تایید شد.';
    }
    inspectionResult = formatTomanAmountsInPlainText(inspectionResult);

    const certificateNumber = `CERT-${order.id.slice(-10).toUpperCase()}${
      side ? `-${side[0]}` : ''
    }`;

    return {
      ownerName: ownerFullName,
      ownerNationalCode,
      itemTitle,
      itemCondition: itemCondition === 'NEW' ? 'نو' : 'کارکرده',
      categoryTitle,
      orderIdShort: order.id.slice(-12),
      orderId: order.id,
      certificateNumber,
      verifiedDate: this.formatJalaliDate(new Date()),
      platformAddress: platformAddress || '—',
      supportPhone: supportPhone || '—',
      inspectionResult,
      trackingCode: '',
    };
  }

  private extractInspectionResultText(
    order: any,
    side: InspectionCertificateSide | null,
  ): string {
    const inspection =
      (order.exchangeHubInspection as Record<string, unknown> | null) ?? null;
    if (inspection && side) {
      const noteKey = side === 'LISTING' ? 'listingNote' : 'offerNote';
      const note = inspection[noteKey];
      if (typeof note === 'string' && note.trim()) return note.trim();
    }
    if (order.cancelReason && typeof order.cancelReason === 'string') {
      return String(order.cancelReason).trim();
    }
    return 'سلامت فنی و مطابقت کالا با مشخصات اعلامی توسط کارشناسان طبقه تایید شد.';
  }

  private applyPlaceholders(
    template: string,
    context: CertificateContext,
  ): string {
    const ctx = context as unknown as Record<string, string | undefined>;
    return template.replace(/\{\{\s*(\w+)\s*\}\}/g, (_, key: string) => {
      const value = ctx[key];
      return value !== undefined && value !== null ? String(value) : '';
    });
  }

  private parseThemePalette(raw: string | undefined): CertificateThemePalette {
    if (!raw?.trim()) return { ...DEFAULT_THEME_PALETTE };
    try {
      const parsed = JSON.parse(raw) as Partial<CertificateThemePalette>;
      return { ...DEFAULT_THEME_PALETTE, ...parsed };
    } catch {
      return { ...DEFAULT_THEME_PALETTE };
    }
  }

  private buildFontFaceCss(): string {
    if (this.fontFaceCssCache) return this.fontFaceCssCache;

    const fonts = resolveCertificateFontFiles();
    const regular = this.readAssetDataUri(fonts.regular, 'font/woff2');
    const bold = this.readAssetDataUri(fonts.bold, 'font/woff2');

    if (!regular) {
      this.logger.warn(
        `Certificate font not found at ${fonts.regular}; PDF may use system fallback`,
      );
    }

    const face = (family: string, weight: number, uri: string | null) =>
      uri
        ? `@font-face{font-family:'${family}';src:url('${uri}') format('woff2');font-weight:${weight};font-style:normal;font-display:block;}`
        : '';

    this.fontFaceCssCache = [
      face(fonts.family, 400, regular),
      face(fonts.family, 700, bold),
    ].join('');
    return this.fontFaceCssCache;
  }

  private getCertificateFontFamily(): string {
    return resolveCertificateFontFiles().family;
  }

  private readAssetDataUri(fullPath: string, mime: string): string | null {
    if (!existsSync(fullPath)) {
      this.logger.warn(`Certificate asset not found: ${fullPath}`);
      return null;
    }
    try {
      const data = readFileSync(fullPath).toString('base64');
      return `data:${mime};base64,${data}`;
    } catch (err) {
      this.logger.warn(`Failed to read asset ${fullPath}: ${err}`);
      return null;
    }
  }

  /** لوگوی اختصاصی گواهی؛ در صورت نبود، لوگوی تم روشن (USER_APP_LOGO_LIGHT یا USER_APP_LOGO قدیمی) استفاده می‌شود. */
  private resolveCertificateLogoDataUri(
    certificateLogoFilename: string,
    userAppLogoFilename: string,
  ): string | null {
    return (
      this.fileToDataUri(
        certificateLogoFilename,
        INSPECTION_CERTIFICATE_ASSET_UPLOAD_PATH,
      ) ?? this.fileToDataUri(userAppLogoFilename, BRAND_LOGO_UPLOAD_PATH)
    );
  }

  private fileToDataUri(
    filename: string,
    uploadPath: string = INSPECTION_CERTIFICATE_ASSET_UPLOAD_PATH,
  ): string | null {
    if (!filename) return null;
    const safeName = filename.split(/[\\/]/).pop();
    if (!safeName) return null;
    const fullPath = join(
      process.cwd(),
      uploadPath.replace(/^\.\//, ''),
      safeName,
    );
    if (!existsSync(fullPath)) return null;
    try {
      const ext = extname(safeName).toLowerCase().replace('.', '');
      const mimeMap: Record<string, string> = {
        jpg: 'image/jpeg',
        jpeg: 'image/jpeg',
        png: 'image/png',
        webp: 'image/webp',
        gif: 'image/gif',
        svg: 'image/svg+xml',
      };
      const mime = mimeMap[ext] || 'image/png';
      const data = readFileSync(fullPath).toString('base64');
      return `data:${mime};base64,${data}`;
    } catch (err) {
      this.logger.warn(`Failed to read certificate asset ${filename}: ${err}`);
      return null;
    }
  }

  /**
   * تبدیل تاریخ میلادی به جلالی با Intl (نود ۲۰+ پشتیبانی می‌کند).
   * خروجی: مثلا "۱۴۰۵/۰۲/۲۶ ساعت ۱۳:۲۲"
   */
  private formatJalaliDate(date: Date): string {
    try {
      const dateFmt = new Intl.DateTimeFormat('fa-IR-u-ca-persian', {
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
      }).format(date);
      const timeFmt = new Intl.DateTimeFormat('fa-IR', {
        hour: '2-digit',
        minute: '2-digit',
        hour12: false,
      }).format(date);
      return `${dateFmt} ساعت ${timeFmt}`;
    } catch {
      return date.toISOString();
    }
  }

  // -------------------------------------------------------------------------
  // HTML template + Puppeteer rendering
  // -------------------------------------------------------------------------

  private renderCertificateHtml(input: {
    title: string;
    body: string;
    footer: string;
    logoDataUri: string | null;
    stampDataUri: string | null;
    context: CertificateContext;
    palette: CertificateThemePalette;
    fontFamily: string;
  }): string {
    return buildInspectionCertificateHtml({
      title: input.title,
      body: input.body,
      footer: input.footer,
      logoDataUri: input.logoDataUri,
      stampDataUri: input.stampDataUri,
      fontFaceCss: this.buildFontFaceCss(),
      context: input.context,
      palette: input.palette,
      fontFamily: input.fontFamily,
    });
  }

  private async getBrowser(): Promise<Browser> {
    if (this.browser) return this.browser;
    if (this.browserPromise) return this.browserPromise;

    this.browserPromise = (async () => {
      const puppeteer = await import('puppeteer');
      const executablePath = this.resolveChromiumExecutablePath(
        puppeteer.default,
      );
      const browser = await puppeteer.default.launch({
        executablePath: executablePath || undefined,
        headless: true,
        args: [
          '--no-sandbox',
          '--disable-setuid-sandbox',
          '--disable-dev-shm-usage',
          '--font-render-hinting=none',
        ],
      });
      this.browser = browser;
      return browser;
    })();

    try {
      return await this.browserPromise;
    } catch (err) {
      this.browserPromise = null;
      throw err;
    }
  }

  /**
   * مسیر اجرایی کرومیوم/کروم/اج را پیدا می‌کنیم.
   * اولویت: env var → مسیرهای رایج سیستم → Chromium باندل Puppeteer.
   */
  private resolveChromiumExecutablePath(puppeteerModule?: {
    executablePath: (channel?: string) => string;
  }): string | null {
    const envPath =
      process.env.PUPPETEER_EXECUTABLE_PATH ||
      process.env.CHROME_PATH ||
      process.env.CHROMIUM_PATH;
    if (envPath && existsSync(envPath)) return envPath;

    const candidates =
      process.platform === 'win32'
        ? [
            'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
            'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
            'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
            'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
          ]
        : process.platform === 'darwin'
          ? [
              '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
              '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge',
              '/Applications/Chromium.app/Contents/MacOS/Chromium',
            ]
          : [
              '/usr/bin/google-chrome',
              '/usr/bin/google-chrome-stable',
              '/usr/bin/chromium',
              '/usr/bin/chromium-browser',
              '/snap/bin/chromium',
            ];

    for (const path of candidates) {
      if (existsSync(path)) return path;
    }

    if (puppeteerModule) {
      try {
        const bundled = puppeteerModule.executablePath();
        if (bundled && existsSync(bundled)) return bundled;
      } catch (err) {
        this.logger.warn(
          'Chromium باندل Puppeteer در دسترس نیست',
          err as Error,
        );
      }
    }

    return null;
  }

  private async renderHtmlToPdf(html: string): Promise<Buffer> {
    let browser: Browser;
    try {
      browser = await this.getBrowser();
    } catch (err) {
      this.logger.error('راه‌اندازی Puppeteer ناموفق بود', err as Error);
      throw new BadRequestException(
        'سرویس تولید PDF در حال حاضر در دسترس نیست؛ مرورگر کرومیوم روی سرور پیدا یا نصب نشده است. لطفاً متغیر PUPPETEER_EXECUTABLE_PATH را به مسیر Chrome/Edge تنظیم کنید.',
      );
    }

    const page = await browser.newPage();
    try {
      await page.setContent(html, { waitUntil: 'domcontentloaded', timeout: 30_000 });
      await page.evaluate(async () => {
        await document.fonts.ready;
      });
      const buffer = await page.pdf({
        format: 'A4',
        printBackground: false,
        preferCSSPageSize: true,
        margin: { top: '12mm', bottom: '12mm', left: '12mm', right: '12mm' },
      });
      return Buffer.from(buffer);
    } finally {
      await page.close().catch(() => undefined);
    }
  }
}
