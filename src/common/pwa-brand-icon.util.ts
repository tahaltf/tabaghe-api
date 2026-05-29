import { existsSync } from 'fs';
import { extname, join } from 'path';
import type { PrismaService } from '../infrastructure/prisma/prisma.service';

const BRAND_DIR = './uploads/brand';

export function getFrontendAppOrigin(): string {
  return (process.env.FRONTEND_APP_URL || 'https://tabagheh.com').replace(/\/+$/, '');
}

export function getPwaIconPublicUrl(): string {
  return `${getFrontendAppOrigin()}/pwa/icon`;
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

export async function getUserAppLogoLightFilename(
  prisma: PrismaService,
): Promise<string | null> {
  const rows = await prisma.systemSetting.findMany({
    where: { key: { in: ['USER_APP_LOGO_LIGHT', 'USER_APP_LOGO'] } },
    select: { key: true, value: true },
  });
  const map = Object.fromEntries(rows.map((r) => [r.key, r.value?.trim() ?? '']));
  const name = map['USER_APP_LOGO_LIGHT'] || map['USER_APP_LOGO'] || '';
  return name || null;
}

/** لوگوی تم تاریک (معمولاً سفید / بدون پس‌زمینه) — برای favicon تب مرورگر */
export async function getUserAppLogoDarkFilename(
  prisma: PrismaService,
): Promise<string | null> {
  const rows = await prisma.systemSetting.findMany({
    where: {
      key: { in: ['USER_APP_LOGO_DARK', 'USER_APP_LOGO_LIGHT', 'USER_APP_LOGO'] },
    },
    select: { key: true, value: true },
  });
  const map = Object.fromEntries(rows.map((r) => [r.key, r.value?.trim() ?? '']));
  const name =
    map['USER_APP_LOGO_DARK'] ||
    map['USER_APP_LOGO_LIGHT'] ||
    map['USER_APP_LOGO'] ||
    '';
  return name || null;
}

export function resolveBrandLogoAbsolutePath(filename: string): string | null {
  const safe = filename.split(/[\\/]/).pop();
  if (!safe) return null;
  const fullPath = join(process.cwd(), BRAND_DIR.replace(/^\.\//, ''), safe);
  if (!existsSync(fullPath)) return null;
  return fullPath;
}

export function buildPwaManifestDocument(_iconAvailable = true) {
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
    name: 'Tabagheh',
    short_name: 'Tabagheh',
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
