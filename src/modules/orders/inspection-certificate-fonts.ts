import { existsSync } from 'fs';
import { join } from 'path';

/** فونت گواهی PDF — Vazirmatn برای نمایش درست فارسی در Chromium/Puppeteer */
export const CERTIFICATE_FONT_FAMILY = 'Vazirmatn';

const VAZIRMATN_FILES = join(
  process.cwd(),
  'node_modules',
  '@fontsource',
  'vazirmatn',
  'files',
);

const LEGACY_ASSETS_DIR = join(process.cwd(), 'assets', 'fonts');

export type CertificateFontFiles = {
  regular: string;
  bold: string;
  family: string;
};

/**
 * مسیر فایل‌های woff2 برای embed در HTML گواهی.
 * اول Vazirmatn از پکیج npm؛ در صورت نبود، Vazir قدیمی assets.
 */
export function resolveCertificateFontFiles(): CertificateFontFiles {
  const vazirmatnRegular = join(
    VAZIRMATN_FILES,
    'vazirmatn-arabic-400-normal.woff2',
  );
  const vazirmatnBold = join(
    VAZIRMATN_FILES,
    'vazirmatn-arabic-700-normal.woff2',
  );

  if (existsSync(vazirmatnRegular) && existsSync(vazirmatnBold)) {
    return {
      regular: vazirmatnRegular,
      bold: vazirmatnBold,
      family: CERTIFICATE_FONT_FAMILY,
    };
  }

  return {
    regular: join(LEGACY_ASSETS_DIR, 'Vazir-FD-WOL.woff2'),
    bold: join(LEGACY_ASSETS_DIR, 'Vazir-Bold-FD-WOL.woff2'),
    family: 'Vazir FD-WOL',
  };
}
