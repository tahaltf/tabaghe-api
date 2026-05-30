import { existsSync } from 'fs';
import { extname, join } from 'path';
import type { PrismaService } from '../infrastructure/prisma/prisma.service';

const BRAND_DIR = './uploads/brand';

export const PWA_SETTING_KEYS = {
  APP_NAME: 'PWA_APP_NAME',
  APP_SHORT_NAME: 'PWA_APP_SHORT_NAME',
  APP_ICON: 'PWA_APP_ICON',
  APP_FAVICON: 'PWA_APP_FAVICON',
} as const;

export function getFrontendAppOrigin(): string {
  return (process.env.FRONTEND_APP_URL || 'https://tabagheh.com').replace(/\/+$/, '');
}

export function getPwaIconPublicUrl(): string {
  return `${getFrontendAppOrigin()}/pwa/icon-512.png`;
}

export function isRasterImageFilename(filename: string): boolean {
  return /\.(png|jpe?g|webp|gif)$/i.test(filename);
}

export function mimeForBrandFilename(filename: string): string {
  const ext = extname(filename).toLowerCase();
  if (ext === '.png') return 'image/png';
  if (ext === '.jpg' || ext === '.jpeg') return 'image/jpeg';
  if (ext === '.webp') return 'image/webp';
  if (ext === '.gif') return 'image/gif';
  if (ext === '.svg') return 'image/svg+xml';
  return 'application/octet-stream';
}

async function readSettingMap(
  prisma: PrismaService,
  keys: string[],
): Promise<Record<string, string>> {
  const rows = await prisma.systemSetting.findMany({
    where: { key: { in: keys } },
    select: { key: true, value: true },
  });
  return Object.fromEntries(rows.map((r) => [r.key, r.value?.trim() ?? '']));
}

/** آیکن نصب اپ — لوگوی روشن روی پس‌زمینه سفید */
export async function getPwaAppIconFilename(
  prisma: PrismaService,
): Promise<string | null> {
  const map = await readSettingMap(prisma, [
    PWA_SETTING_KEYS.APP_ICON,
    'USER_APP_LOGO_LIGHT',
    'USER_APP_LOGO',
  ]);
  const name =
    map[PWA_SETTING_KEYS.APP_ICON] ||
    map['USER_APP_LOGO_LIGHT'] ||
    map['USER_APP_LOGO'] ||
    '';
  return name || null;
}

/** favicon تب مرورگر — لوگوی تیره، پس‌زمینه شفاف */
export async function getPwaFaviconFilename(
  prisma: PrismaService,
): Promise<string | null> {
  const map = await readSettingMap(prisma, [
    PWA_SETTING_KEYS.APP_FAVICON,
    'USER_APP_LOGO_DARK',
    'USER_APP_LOGO_LIGHT',
    'USER_APP_LOGO',
  ]);
  const name =
    map[PWA_SETTING_KEYS.APP_FAVICON] ||
    map['USER_APP_LOGO_DARK'] ||
    map['USER_APP_LOGO_LIGHT'] ||
    map['USER_APP_LOGO'] ||
    '';
  return name || null;
}

/** @deprecated use getPwaAppIconFilename */
export async function getUserAppLogoLightFilename(
  prisma: PrismaService,
): Promise<string | null> {
  return getPwaAppIconFilename(prisma);
}

/** @deprecated use getPwaFaviconFilename */
export async function getUserAppLogoDarkFilename(
  prisma: PrismaService,
): Promise<string | null> {
  return getPwaFaviconFilename(prisma);
}

export async function getPwaAppName(prisma: PrismaService): Promise<string> {
  const map = await readSettingMap(prisma, [PWA_SETTING_KEYS.APP_NAME]);
  return map[PWA_SETTING_KEYS.APP_NAME] || 'طبقه';
}

export async function getPwaAppShortName(prisma: PrismaService): Promise<string> {
  const map = await readSettingMap(prisma, [
    PWA_SETTING_KEYS.APP_SHORT_NAME,
    PWA_SETTING_KEYS.APP_NAME,
  ]);
  return (
    map[PWA_SETTING_KEYS.APP_SHORT_NAME] ||
    map[PWA_SETTING_KEYS.APP_NAME] ||
    'طبقه'
  );
}

export function resolveBrandLogoAbsolutePath(filename: string): string | null {
  const safe = filename.split(/[\\/]/).pop();
  if (!safe) return null;
  const fullPath = join(process.cwd(), BRAND_DIR.replace(/^\.\//, ''), safe);
  if (!existsSync(fullPath)) return null;
  return fullPath;
}

export function buildPwaManifestDocument(
  appName: string,
  shortName: string,
  _iconAvailable = true,
) {
  const origin = getFrontendAppOrigin();
  const icons = [
    {
      src: `${origin}/pwa/apple-touch-icon.png`,
      sizes: '180x180',
      type: 'image/png',
      purpose: 'any',
    },
    {
      src: `${origin}/pwa/icon-192.png`,
      sizes: '192x192',
      type: 'image/png',
      purpose: 'any',
    },
    {
      src: `${origin}/pwa/icon-512.png`,
      sizes: '512x512',
      type: 'image/png',
      purpose: 'any',
    },
    {
      src: `${origin}/pwa/icon-512.png`,
      sizes: '512x512',
      type: 'image/png',
      purpose: 'maskable',
    },
  ];

  return {
    name: appName,
    short_name: shortName,
    id: '/',
    theme_color: '#ef684c',
    background_color: '#ffffff',
    display: 'standalone',
    orientation: 'portrait',
    lang: 'fa',
    scope: '/',
    start_url: '/',
    icons,
  };
}
