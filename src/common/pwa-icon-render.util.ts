import { readFile, stat } from 'fs/promises';
import sharp = require('sharp');

const BRAND_ACCENT = '#ef684c';

const PNG_OUT = { compressionLevel: 6, effort: 4 } as const;

function openSource(sourcePath: string, rasterSide: number): sharp.Sharp {
  const density = Math.max(300, Math.ceil(rasterSide * 4));
  return /\.svg$/i.test(sourcePath)
    ? sharp(sourcePath, { density })
    : sharp(sourcePath);
}

async function resizeLogo(
  sourcePath: string,
  inner: number,
  background: { r: number; g: number; b: number; alpha: number },
): Promise<Buffer> {
  const meta = await openSource(sourcePath, inner).metadata();
  const srcMax = Math.max(meta.width ?? 1, meta.height ?? 1);
  const upscale = inner / srcMax;

  let pipeline = openSource(sourcePath, inner).resize(inner, inner, {
    fit: 'contain',
    kernel: sharp.kernel.lanczos3,
    background,
  });

  if (upscale > 1.25) {
    pipeline = pipeline.sharpen({ sigma: 0.5, m1: 0.8, m2: 0.4 });
  }

  return pipeline.png(PNG_OUT).toBuffer();
}

async function isReadyMadeSquareIcon(
  sourcePath: string,
  targetSide: number,
): Promise<boolean> {
  const meta = await openSource(sourcePath, targetSide).metadata();
  const w = meta.width ?? 0;
  const h = meta.height ?? 0;
  return w === h && w >= targetSide;
}

/** PNG مربعی با پس‌زمینه سفید برای iOS / Add to Home Screen */
export async function renderPwaIconPng(
  sourcePath: string,
  size: number,
): Promise<Buffer> {
  const side = Math.max(48, Math.min(1024, Math.floor(size)));
  if (await isReadyMadeSquareIcon(sourcePath, side)) {
    return openSource(sourcePath, side)
      .resize(side, side, {
        fit: 'cover',
        kernel: sharp.kernel.lanczos3,
      })
      .png(PNG_OUT)
      .toBuffer();
  }
  const padding = Math.round(side * 0.08);
  const inner = side - padding * 2;
  const transparent = { r: 255, g: 255, b: 255, alpha: 0 };
  const logo = await resizeLogo(sourcePath, inner, transparent);

  return sharp({
    create: {
      width: side,
      height: side,
      channels: 4,
      background: { r: 255, g: 255, b: 255, alpha: 1 },
    },
  })
    .composite([{ input: logo, gravity: 'centre' }])
    .png(PNG_OUT)
    .toBuffer();
}

/** favicon تب مرورگر: لوگوی سفید/تم تاریک، پس‌زمینه شفاف */
export async function renderFaviconPng(
  sourcePath: string,
  size: number,
): Promise<Buffer> {
  const side = Math.max(16, Math.min(512, Math.floor(size)));
  const padding = Math.round(side * 0.05);
  const inner = Math.max(8, side - padding * 2);
  const transparent = { r: 0, g: 0, b: 0, alpha: 0 };
  const logo = await resizeLogo(sourcePath, inner, transparent);

  return sharp({
    create: {
      width: side,
      height: side,
      channels: 4,
      background: transparent,
    },
  })
    .composite([{ input: logo, gravity: 'centre' }])
    .png(PNG_OUT)
    .toBuffer();
}

export async function renderFaviconFallbackPng(size: number): Promise<Buffer> {
  const side = Math.max(16, Math.min(512, Math.floor(size)));
  const fontSize = Math.round(side * 0.32);
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${side}" height="${side}" viewBox="0 0 ${side} ${side}">
  <text x="50%" y="54%" text-anchor="middle" dominant-baseline="middle"
    font-family="Tahoma, 'Segoe UI', Arial, sans-serif" font-weight="700" font-size="${fontSize}" fill="#ffffff">طبقه</text>
</svg>`;
  return sharp(Buffer.from(svg)).png(PNG_OUT).toBuffer();
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
  return sharp(Buffer.from(svg)).png(PNG_OUT).toBuffer();
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
