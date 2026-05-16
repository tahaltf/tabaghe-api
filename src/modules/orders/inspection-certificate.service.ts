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
import { INSPECTION_CERTIFICATE_ASSET_UPLOAD_PATH } from '../../common/upload/inspection-certificate-asset-upload.config';

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
  trackingCode: string;
  orderId: string;
  certificateNumber: string;
  verifiedDate: string;
  platformAddress: string;
  supportPhone: string;
  inspectionResult: string;
}

@Injectable()
export class InspectionCertificateService implements OnModuleDestroy {
  private readonly logger = new Logger(InspectionCertificateService.name);
  private browser: Browser | null = null;
  private browserPromise: Promise<Browser> | null = null;

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
      title: this.applyPlaceholders(settings.title, context),
      body: this.applyPlaceholders(settings.body, context),
      footer: this.applyPlaceholders(settings.footer, context),
      logoDataUri: this.fileToDataUri(settings.logoFilename),
      stampDataUri: this.fileToDataUri(settings.stampFilename),
      context,
    });

    const pdf = await this.renderHtmlToPdf(html);
    const safeOrderId = orderId.replace(/[^a-zA-Z0-9_-]/g, '');
    const sideSuffix = resolvedSide ? `-${resolvedSide.toLowerCase()}` : '';
    const filename = `inspection-certificate-${safeOrderId}${sideSuffix}.pdf`;
    return { pdf, filename };
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
      SETTING_KEYS.PLATFORM_ADDRESS,
      SETTING_KEYS.SUPPORT_PHONE,
    ];
    const rows = await this.prisma.systemSetting.findMany({
      where: { key: { in: keys } },
    });
    const map = new Map(rows.map((r) => [r.key, r.value]));
    return {
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
    let itemCondition: 'NEW' | 'USED' = order.listing?.condition ?? 'USED';
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
    const ownerNationalCode = owner?.nationalCode || '—';
    const trackingCode =
      order.hubToBuyerTrackingCode ||
      order.hubToSellerTrackingCode ||
      order.trackingCode ||
      '—';

    const inspectionResult = this.extractInspectionResultText(order, side);

    const certificateNumber = `CERT-${order.id.slice(-10).toUpperCase()}${
      side ? `-${side[0]}` : ''
    }`;

    return {
      ownerName: ownerFullName,
      ownerNationalCode,
      itemTitle,
      itemCondition: itemCondition === 'NEW' ? 'نو' : 'کارکرده',
      categoryTitle,
      trackingCode,
      orderId: order.id,
      certificateNumber,
      verifiedDate: this.formatJalaliDate(new Date()),
      platformAddress: platformAddress || '—',
      supportPhone: supportPhone || '—',
      inspectionResult,
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

  private fileToDataUri(filename: string): string | null {
    if (!filename) return null;
    const safeName = filename.split(/[\\/]/).pop();
    if (!safeName) return null;
    const fullPath = join(
      process.cwd(),
      INSPECTION_CERTIFICATE_ASSET_UPLOAD_PATH.replace(/^\.\//, ''),
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
  }): string {
    const { title, body, footer, logoDataUri, stampDataUri, context } = input;

    const escape = (s: string) =>
      String(s ?? '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;');
    const nl2br = (s: string) =>
      escape(s)
        .split(/\r?\n/)
        .map((l) => l)
        .join('<br/>');

    const logoBlock = logoDataUri
      ? `<img class="cert-logo" src="${logoDataUri}" alt="logo"/>`
      : `<div class="cert-logo-placeholder">طَبَقـه</div>`;

    const stampBlock = stampDataUri
      ? `<img class="cert-stamp" src="${stampDataUri}" alt="stamp"/>`
      : '';

    return `<!doctype html>
<html lang="fa" dir="rtl">
<head>
<meta charset="utf-8"/>
<title>${escape(title)}</title>
<style>
  @page { size: A4; margin: 18mm 16mm; }
  * { box-sizing: border-box; }
  html, body {
    font-family: "Tahoma", "Vazirmatn", "IRANSans", "Segoe UI", Arial, sans-serif;
    color: #1f2937;
    -webkit-print-color-adjust: exact;
    print-color-adjust: exact;
  }
  body { margin: 0; padding: 0; background: #fff; }
  .cert-frame {
    border: 3px double #c9a227;
    padding: 28px 26px 26px;
    border-radius: 14px;
    position: relative;
    min-height: 250mm;
    display: flex;
    flex-direction: column;
  }
  .cert-frame::before, .cert-frame::after {
    content: "";
    position: absolute;
    width: 36px; height: 36px;
    border: 2px solid #c9a227;
    border-radius: 8px;
  }
  .cert-frame::before { top: 8px; right: 8px; border-bottom: none; border-left: none; }
  .cert-frame::after { bottom: 8px; left: 8px; border-top: none; border-right: none; }
  .cert-header {
    display: flex; align-items: center; justify-content: space-between;
    border-bottom: 1px dashed #d4af37; padding-bottom: 14px; margin-bottom: 18px;
  }
  .cert-logo { max-height: 70px; max-width: 200px; object-fit: contain; }
  .cert-logo-placeholder {
    font-size: 28px; font-weight: 900; color: #d4af37;
    border: 2px solid #d4af37; padding: 6px 14px; border-radius: 6px;
  }
  .cert-meta {
    text-align: left; font-size: 11px; color: #4b5563; line-height: 1.9;
  }
  .cert-meta strong { color: #111827; }
  .cert-title {
    text-align: center;
    font-size: 26px; font-weight: 900;
    color: #b8860b;
    letter-spacing: 1px;
    margin: 18px 0 22px;
    position: relative;
  }
  .cert-title::after {
    content: ""; display: block; width: 90px; height: 3px; background: #c9a227;
    margin: 10px auto 0; border-radius: 2px;
  }
  .cert-body {
    font-size: 14px; line-height: 2.0; color: #1f2937;
    text-align: justify;
    padding: 0 6px;
    flex: 1 0 auto;
  }
  .cert-info-box {
    margin-top: 18px;
    background: #fffbeb;
    border: 1px solid #fde68a;
    border-radius: 10px;
    padding: 12px 16px;
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 8px 24px;
    font-size: 12.5px;
  }
  .cert-info-box .row { display: flex; gap: 6px; }
  .cert-info-box .label { color: #6b7280; min-width: 90px; }
  .cert-info-box .val { color: #111827; font-weight: 700; }
  .cert-stamp-area {
    margin-top: auto;
    padding-top: 24px;
    display: flex;
    align-items: flex-end;
    justify-content: space-between;
    gap: 24px;
  }
  .cert-stamp-area .stamp-wrap {
    text-align: center; min-width: 160px;
  }
  .cert-stamp { max-height: 130px; max-width: 180px; object-fit: contain; opacity: .92; }
  .cert-stamp-label {
    font-size: 11px; color: #6b7280; margin-top: 4px;
  }
  .cert-footer {
    border-top: 1px dashed #d4af37;
    margin-top: 22px;
    padding-top: 14px;
    font-size: 11.5px;
    color: #4b5563;
    line-height: 1.9;
    text-align: center;
    white-space: pre-line;
  }
  .cert-footer strong { color: #1f2937; }
</style>
</head>
<body>
  <div class="cert-frame">
    <div class="cert-header">
      ${logoBlock}
      <div class="cert-meta">
        <div><strong>شماره گواهی:</strong> ${escape(context.certificateNumber)}</div>
        <div><strong>تاریخ صدور:</strong> ${escape(context.verifiedDate)}</div>
        <div><strong>شماره سفارش:</strong> ${escape(context.orderId)}</div>
      </div>
    </div>

    <h1 class="cert-title">${escape(title)}</h1>

    <div class="cert-body">${nl2br(body)}</div>

    <div class="cert-info-box">
      <div class="row"><span class="label">صاحب کالا:</span><span class="val">${escape(context.ownerName)}</span></div>
      <div class="row"><span class="label">کد ملی:</span><span class="val">${escape(context.ownerNationalCode)}</span></div>
      <div class="row"><span class="label">عنوان کالا:</span><span class="val">${escape(context.itemTitle)}</span></div>
      <div class="row"><span class="label">دسته‌بندی:</span><span class="val">${escape(context.categoryTitle)}</span></div>
      <div class="row"><span class="label">وضعیت کالا:</span><span class="val">${escape(context.itemCondition)}</span></div>
      <div class="row"><span class="label">کد رهگیری:</span><span class="val">${escape(context.trackingCode)}</span></div>
    </div>

    <div class="cert-stamp-area">
      <div class="stamp-wrap">
        ${stampBlock}
        <div class="cert-stamp-label">مهر و امضای مرکز پردازش طبقه</div>
      </div>
      <div style="text-align:center; min-width:160px;">
        <div style="border-top:1px solid #9ca3af; padding-top:6px; font-size:11px; color:#6b7280;">
          امضای کارشناس مسئول
        </div>
      </div>
    </div>

    <div class="cert-footer">${nl2br(footer)}</div>
  </div>
</body>
</html>`;
  }

  private async getBrowser(): Promise<Browser> {
    if (this.browser) return this.browser;
    if (this.browserPromise) return this.browserPromise;

    this.browserPromise = (async () => {
      const puppeteer = await import('puppeteer');
      const executablePath = this.resolveChromiumExecutablePath();
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
   * اولویت: env var → puppeteer cache → مسیرهای رایج ویندوز/لینوکس.
   */
  private resolveChromiumExecutablePath(): string | null {
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
      // 'domcontentloaded' is sufficient because we embed images as data URIs (no network)
      await page.setContent(html, { waitUntil: 'domcontentloaded' });
      const buffer = await page.pdf({
        format: 'A4',
        printBackground: true,
        margin: {
          top: '14mm',
          bottom: '14mm',
          left: '12mm',
          right: '12mm',
        },
      });
      return Buffer.from(buffer);
    } finally {
      await page.close().catch(() => undefined);
    }
  }
}
