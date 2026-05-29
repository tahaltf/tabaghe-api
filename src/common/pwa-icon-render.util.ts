import { readFile, stat } from 'fs/promises';
import sharp from 'sharp';

const BRAND_ACCENT = '#ef684c';

/** PNG مربعی با پس‌زمینه سفید برای iOS / Add to Home Screen */
export async function renderPwaIconPng(
  sourcePath: string,
  size: number,
): Promise<Buffer> {
  const side = Math.max(48, Math.min(1024, Math.floor(size)));
  const padding = Math.round(side * 0.12);
  const inner = side - padding * 2;

  const resized = await sharp(sourcePath)
    .resize(inner, inner, {
      fit: 'contain',
      background: { r: 255, g: 255, b: 255, alpha: 0 },
    })
    .png()
    .toBuffer();

  return sharp({
    create: {
      width: side,
      height: side,
      channels: 4,
      background: { r: 255, g: 255, b: 255, alpha: 1 },
    },
  })
    .composite([{ input: resized, gravity: 'centre' }])
    .png()
    .toBuffer();
}

/** favicon تب مرورگر: لوگوی سفید/تم تاریک، پس‌زمینه شفاف */
export async function renderFaviconPng(
  sourcePath: string,
  size: number,
): Promise<Buffer> {
  const side = Math.max(16, Math.min(512, Math.floor(size)));
  const padding = Math.round(side * 0.06);
  const inner = Math.max(8, side - padding * 2);

  const logo = await sharp(sourcePath)
    .resize(inner, inner, {
      fit: 'contain',
      background: { r: 0, g: 0, b: 0, alpha: 0 },
    })
    .png()
    .toBuffer();

  return sharp({
    create: {
      width: side,
      height: side,
      channels: 4,
      background: { r: 0, g: 0, b: 0, alpha: 0 },
    },
  })
    .composite([{ input: logo, gravity: 'centre' }])
    .png()
    .toBuffer();
}

export async function renderFaviconFallbackPng(size: number): Promise<Buffer> {
  const side = Math.max(16, Math.min(512, Math.floor(size)));
  const fontSize = Math.round(side * 0.32);
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${side}" height="${side}" viewBox="0 0 ${side} ${side}">
  <text x="50%" y="54%" text-anchor="middle" dominant-baseline="middle"
    font-family="Tahoma, 'Segoe UI', Arial, sans-serif" font-weight="700" font-size="${fontSize}" fill="#ffffff">طبقه</text>
</svg>`;
  return sharp(Buffer.from(svg)).png().toBuffer();
}

/** وقتی لوگوی ادمین تنظیم نشده — متن «طبقه» روی زمینه سفید (نه آیکن نارنجی placeholder) */
export async function renderPwaFallbackPng(size: number): Promise<Buffer> {
  const side = Math.max(48, Math.min(1024, Math.floor(size)));
  const fontSize = Math.round(side * 0.28);
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${side}" height="${side}" viewBox="0 0 ${side} ${side}">
  <rect width="100%" height="100%" fill="#ffffff"/>
  <text x="50%" y="54%" text-anchor="middle" dominant-baseline="middle"
    font-family="Tahoma, 'Segoe UI', Arial, sans-serif" font-weight="700" font-size="${fontSize}" fill="${BRAND_ACCENT}">طبقه</text>
</svg>`;
  return sharp(Buffer.from(svg)).png().toBuffer();
}

export async function fileMtimeMs(path: string): Promise<number> {
  try {
    const s = await stat(path);
    return s.mtimeMs;
  } catch {
    return 0;
  }
}

export async function readFileIfExists(path: string): Promise<Buffer | null> {
  try {
    return await readFile(path);
  } catch {
    return null;
  }
}
