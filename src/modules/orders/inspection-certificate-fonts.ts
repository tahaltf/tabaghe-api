import { join } from 'path';

/** فونت گواهی PDF — IRANSansX برای نمایش درست فارسی در Chromium/Puppeteer */
export const CERTIFICATE_FONT_FAMILY = 'IRANSansX';

const FONTS_DIR = join(process.cwd(), 'assets', 'fonts');

export type CertificateFontFiles = {
  regular: string;
  bold: string;
  family: string;
};

/**
 * مسیر فایل‌های woff2 برای embed در HTML گواهی.
 */
export function resolveCertificateFontFiles(): CertificateFontFiles {
  const regular = join(FONTS_DIR, 'IRANSansXFaNum-Regular.woff2');
  const bold = join(FONTS_DIR, 'IRANSansXFaNum-Bold.woff2');

  return {
    regular,
    bold,
    family: CERTIFICATE_FONT_FAMILY,
  };
}
