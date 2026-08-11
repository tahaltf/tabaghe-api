import { Injectable, Logger } from '@nestjs/common';
import { createReadStream, existsSync, mkdirSync, writeFileSync } from 'fs';
import { join } from 'path';
import sharp = require('sharp');
import { AiContentSettingsService } from '../services/ai-content-settings.service';
import type { StoryGenerationInput } from '../utils/story-prompt.builder';
import { buildStoryImagePrompt } from '../utils/story-prompt.builder';
import { AI_CONTENT_UPLOAD_DIR } from '../ai-content.constants';

class LiaraImageEditError extends Error {
  constructor(
    message: string,
    readonly reason: 'timeout' | 'http' | 'empty' | 'network',
  ) {
    super(message);
    this.name = 'LiaraImageEditError';
  }
}

@Injectable()
export class OpenAiImageProvider {
  private readonly logger = new Logger(OpenAiImageProvider.name);

  constructor(private readonly settings: AiContentSettingsService) {}

  async generateStoryImage(params: {
    input: StoryGenerationInput;
    productImagePath: string;
    caption: string;
    outputFileName: string;
  }): Promise<{ buffer: Buffer; provider: string; model: string }> {
    const apiKey = this.settings.getOpenAiApiKey();
    const model = await this.settings.getImageModel();

    if (!apiKey) {
      this.logger.warn('No Liara/OpenAI API key configured; using Sharp fallback');
      const buffer = await this.composeFallbackStory({
        productImagePath: params.productImagePath,
        title: params.input.listingTitle,
        caption: params.caption,
        priceLabel: params.input.priceLabel,
      });
      return { buffer, provider: 'sharp-fallback', model: 'local-compose' };
    }

    const prompt = buildStoryImagePrompt(params.input);
    let lastError: LiaraImageEditError | null = null;

    // یک بار تلاش مجدد برای timeout/شبکه — جاب async است و کاربر منتظر poll است
    for (let attempt = 1; attempt <= 2; attempt++) {
      try {
        const aiBuffer = await this.tryOpenAiEdit({
          apiKey,
          model,
          prompt,
          productImagePath: params.productImagePath,
          attempt,
        });
        const withBrand = await this.applyBrandOverlay(aiBuffer);
        return { buffer: withBrand, provider: 'liara', model };
      } catch (err) {
        const mapped = this.toLiaraError(err);
        lastError = mapped;
        this.logger.warn(
          `Liara image edit attempt=${attempt} reason=${mapped.reason}: ${mapped.message}`,
        );
        const retryable =
          mapped.reason === 'timeout' || mapped.reason === 'network';
        if (!retryable || attempt === 2) break;
      }
    }

    throw new Error(this.friendlyFailureMessage(lastError));
  }

  saveToUploads(fileName: string, buffer: Buffer): string {
    if (!existsSync(AI_CONTENT_UPLOAD_DIR)) {
      mkdirSync(AI_CONTENT_UPLOAD_DIR, { recursive: true });
    }
    const localPath = join(AI_CONTENT_UPLOAD_DIR, fileName).replace(/\\/g, '/');
    writeFileSync(localPath, buffer);
    return localPath;
  }

  publicUrlForFile(fileName: string): string {
    return `/uploads/ai-content/${fileName}`;
  }

  localPathForFile(fileName: string): string {
    return join(AI_CONTENT_UPLOAD_DIR, fileName).replace(/\\/g, '/');
  }

  streamFile(localPath: string) {
    return createReadStream(localPath);
  }

  private friendlyFailureMessage(err: LiaraImageEditError | null): string {
    if (!err) {
      return 'ساخت تصویر با هوش مصنوعی انجام نشد. لطفاً چند لحظه بعد دوباره تلاش کنید.';
    }
    if (err.reason === 'timeout') {
      return 'ساخت تصویر بیشتر از حد انتظار طول کشید. لطفاً دوباره تلاش کنید یا در پنل ادمین مهلت لیارا را افزایش دهید.';
    }
    if (err.reason === 'http') {
      return `سرویس تصویر لیارا پاسخ نامعتبر داد. ${err.message}`.slice(0, 400);
    }
    if (err.reason === 'network') {
      return 'ارتباط با سرویس تصویر برقرار نشد. لطفاً چند لحظه بعد دوباره تلاش کنید.';
    }
    return 'ساخت تصویر با هوش مصنوعی انجام نشد. لطفاً چند لحظه بعد دوباره تلاش کنید.';
  }

  private toLiaraError(err: unknown): LiaraImageEditError {
    if (err instanceof LiaraImageEditError) return err;
    const message = String((err as Error)?.message ?? err);
    if ((err as Error)?.name === 'AbortError' || /aborted|timeout/i.test(message)) {
      return new LiaraImageEditError(message, 'timeout');
    }
    return new LiaraImageEditError(message, 'network');
  }

  private async tryOpenAiEdit(params: {
    apiKey: string;
    model: string;
    prompt: string;
    productImagePath: string;
    attempt: number;
    omitQuality?: boolean;
  }): Promise<Buffer> {
    const baseUrl = this.settings.getOpenAiBaseUrl();
    const [timeoutMs, size, inputMaxPx] = await Promise.all([
      this.settings.getImageEditTimeoutMs(),
      this.settings.getImageSize(),
      this.settings.getImageInputMaxPx(),
    ]);

    const imageBuffer = await sharp(params.productImagePath)
      .rotate()
      .resize(inputMaxPx, inputMaxPx, { fit: 'inside', withoutEnlargement: true })
      .png()
      .toBuffer();

    const form = new FormData();
    form.append('model', params.model);
    form.append('prompt', params.prompt.slice(0, 4000));
    form.append(
      'image',
      new File([new Uint8Array(imageBuffer)], 'product.png', {
        type: 'image/png',
      }),
    );
    form.append('size', size);
    // gpt-image: response_format unsupported. quality=high optional (Liara may reject).
    const sendQuality =
      !params.omitQuality && /gpt-image/i.test(params.model);
    if (sendQuality) {
      form.append('quality', 'high');
    }

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    this.logger.log(
      `Liara images/edits attempt=${params.attempt} model=${params.model} size=${size} timeoutMs=${timeoutMs} bytes=${imageBuffer.length} quality=${sendQuality}`,
    );

    let res: Response;
    try {
      res = await fetch(`${baseUrl}/images/edits`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${params.apiKey}` },
        body: form,
        signal: controller.signal,
      });
    } catch (err) {
      if ((err as Error)?.name === 'AbortError') {
        throw new LiaraImageEditError(
          `timeout after ${timeoutMs}ms`,
          'timeout',
        );
      }
      throw new LiaraImageEditError(
        String((err as Error)?.message ?? err),
        'network',
      );
    } finally {
      clearTimeout(timer);
    }

    if (!res.ok) {
      const body = (await res.text()).slice(0, 500);
      this.logger.warn(`Liara image edit HTTP ${res.status}: ${body}`);
      if (
        sendQuality &&
        /Unknown parameter:\s*['"]?quality['"]?/i.test(body)
      ) {
        return this.tryOpenAiEdit({ ...params, omitQuality: true });
      }
      throw new LiaraImageEditError(
        this.summarizeHttpFailure(res.status, body),
        'http',
      );
    }

    const data = (await res.json()) as {
      data?: Array<{ b64_json?: string; url?: string }>;
      error?: { message?: string };
    };

    const item = data.data?.[0];
    if (item?.b64_json) {
      return Buffer.from(item.b64_json, 'base64');
    }
    if (item?.url) {
      const imgRes = await fetch(item.url, {
        signal: AbortSignal.timeout(30_000),
      });
      if (!imgRes.ok) {
        throw new LiaraImageEditError(
          `download url failed HTTP ${imgRes.status}`,
          'empty',
        );
      }
      return Buffer.from(await imgRes.arrayBuffer());
    }

    const hint = data.error?.message || 'empty data[]';
    throw new LiaraImageEditError(hint, 'empty');
  }

  private summarizeHttpFailure(status: number, body: string): string {
    if (status === 401 || status === 403) {
      return 'کلید API لیارا نامعتبر است یا دسترسی ندارد.';
    }
    if (status === 402) {
      return 'اعتبار سرویس لیارا کافی نیست.';
    }
    if (status === 429) {
      return 'محدودیت نرخ لیارا؛ کمی بعد دوباره تلاش کنید.';
    }
    if (status >= 500) {
      return `خطای موقت لیارا (${status}).`;
    }
    // پیام کوتاه از بدنه اگر قابل خواندن باشد
    try {
      const parsed = JSON.parse(body) as {
        error?: { message?: string } | string;
        message?: string;
      };
      const msg =
        (typeof parsed.error === 'object' ? parsed.error?.message : parsed.error) ||
        parsed.message;
      if (msg) return String(msg).slice(0, 180);
    } catch {
      /* ignore */
    }
    return `خطای ${status} از لیارا.`;
  }

  private async composeFallbackStory(params: {
    productImagePath: string;
    title: string;
    caption: string;
    priceLabel?: string | null;
  }): Promise<Buffer> {
    const width = 1080;
    const height = 1920;

    const backgroundSvg = `
      <svg width="${width}" height="${height}" xmlns="http://www.w3.org/2000/svg">
        <defs>
          <linearGradient id="bg" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stop-color="#f7f5f2"/>
            <stop offset="55%" stop-color="#efeae3"/>
            <stop offset="100%" stop-color="#e4ddd4"/>
          </linearGradient>
          <linearGradient id="panel" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stop-color="#1c1917" stop-opacity="0"/>
            <stop offset="35%" stop-color="#1c1917" stop-opacity="0.55"/>
            <stop offset="100%" stop-color="#1c1917" stop-opacity="0.92"/>
          </linearGradient>
        </defs>
        <rect width="100%" height="100%" fill="url(#bg)"/>
        <circle cx="920" cy="180" r="220" fill="#d6cfc4" opacity="0.45"/>
        <circle cx="120" cy="520" r="160" fill="#cbbfaf" opacity="0.28"/>
        <rect x="0" y="1180" width="${width}" height="740" fill="url(#panel)"/>
      </svg>`;

    const productMax = 820;
    const product = await sharp(params.productImagePath)
      .rotate()
      .resize(productMax, productMax, {
        fit: 'inside',
        withoutEnlargement: true,
        background: { r: 0, g: 0, b: 0, alpha: 0 },
      })
      .png()
      .toBuffer();

    const productMeta = await sharp(product).metadata();
    const pw = productMeta.width ?? productMax;
    const ph = productMeta.height ?? productMax;

    const framePad = 36;
    const frameW = pw + framePad * 2;
    const frameH = ph + framePad * 2;
    const frameSvg = `
      <svg width="${frameW}" height="${frameH}" xmlns="http://www.w3.org/2000/svg">
        <defs>
          <filter id="s" x="-20%" y="-20%" width="140%" height="140%">
            <feDropShadow dx="0" dy="18" stdDeviation="22" flood-color="#1c1917" flood-opacity="0.18"/>
          </filter>
        </defs>
        <rect x="8" y="8" width="${frameW - 16}" height="${frameH - 16}" rx="36" ry="36"
          fill="#ffffff" filter="url(#s)"/>
      </svg>`;

    const frameWithProduct = await sharp(Buffer.from(frameSvg))
      .composite([{ input: product, top: framePad, left: framePad }])
      .png()
      .toBuffer();

    const frameMeta = await sharp(frameWithProduct).metadata();
    const fw = frameMeta.width ?? frameW;
    const fh = frameMeta.height ?? frameH;
    const productTop = Math.max(160, Math.round((1180 - fh) / 2));
    const productLeft = Math.round((width - fw) / 2);

    const titleLines = this.wrapDisplayText(
      this.sanitizeDisplayText(params.title, 56),
      22,
      2,
    ).map((line) => this.escapeXml(line));
    const price = params.priceLabel
      ? this.escapeXml(this.sanitizeDisplayText(params.priceLabel, 36))
      : '';
    const subtitle = this.escapeXml(
      this.sanitizeDisplayText(params.caption, 70),
    );

    const titleTspans = titleLines
      .map(
        (line, i) =>
          `<tspan x="540" dy="${i === 0 ? 0 : 58}">${line}</tspan>`,
      )
      .join('');

    const textSvg = `
      <svg width="${width}" height="${height}" xmlns="http://www.w3.org/2000/svg">
        <style>
          .title {
            fill: #fffaf5;
            font-size: 48px;
            font-family: Tahoma, Arial, sans-serif;
            font-weight: 700;
          }
          .price {
            fill: #f5d78e;
            font-size: 36px;
            font-family: Tahoma, Arial, sans-serif;
            font-weight: 700;
          }
          .sub {
            fill: #e7e0d8;
            font-size: 26px;
            font-family: Tahoma, Arial, sans-serif;
          }
          .brand {
            fill: #fffaf5;
            font-size: 34px;
            font-family: Tahoma, Arial, sans-serif;
            font-weight: 800;
            letter-spacing: -0.5px;
          }
          .cta {
            fill: #1c1917;
            font-size: 26px;
            font-family: Tahoma, Arial, sans-serif;
            font-weight: 700;
          }
        </style>
        <text x="540" y="1320" text-anchor="middle" direction="rtl" class="title">${titleTspans}</text>
        ${
          price
            ? `<text x="540" y="1460" text-anchor="middle" direction="rtl" class="price">${price}</text>`
            : ''
        }
        ${
          subtitle
            ? `<text x="540" y="1525" text-anchor="middle" direction="rtl" class="sub">${subtitle}</text>`
            : ''
        }
        <rect x="330" y="1680" width="420" height="72" rx="36" fill="#fffaf5"/>
        <text x="540" y="1726" text-anchor="middle" direction="rtl" class="cta">خرید از طبقه</text>
        <text x="540" y="1840" text-anchor="middle" class="brand">طَبَقـه.</text>
      </svg>`;

    let pipeline = sharp(Buffer.from(backgroundSvg)).composite([
      { input: frameWithProduct, top: productTop, left: productLeft },
      { input: Buffer.from(textSvg), top: 0, left: 0 },
    ]);

    pipeline = await this.overlayBrandLogo(pipeline, width, height);
    return pipeline.png().toBuffer();
  }

  private wrapDisplayText(
    value: string,
    maxChars: number,
    maxLines: number,
  ): string[] {
    const text = value.trim();
    if (!text) return [];
    if (text.length <= maxChars) return [text];

    const words = text.split(/\s+/);
    const lines: string[] = [];
    let current = '';
    for (const word of words) {
      const next = current ? `${current} ${word}` : word;
      if (next.length <= maxChars) {
        current = next;
        continue;
      }
      if (current) lines.push(current);
      current = word;
      if (lines.length >= maxLines) break;
    }
    if (lines.length < maxLines && current) lines.push(current);

    if (lines.length > maxLines) return lines.slice(0, maxLines);
    if (
      lines.length === maxLines &&
      text.length > lines.join(' ').length
    ) {
      const last = lines[maxLines - 1];
      lines[maxLines - 1] =
        last.length > 3 ? `${last.slice(0, Math.max(3, last.length - 1))}…` : `${last}…`;
    }
    return lines;
  }

  private async applyBrandOverlay(buffer: Buffer): Promise<Buffer> {
    const width = 1080;
    const height = 1920;
    let pipeline = sharp(buffer).resize(width, height, { fit: 'cover' });
    pipeline = await this.overlayBrandLogo(pipeline, width, height);
    return pipeline.png().toBuffer();
  }

  private async overlayBrandLogo(
    pipeline: sharp.Sharp,
    width: number,
    height: number,
  ): Promise<sharp.Sharp> {
    try {
      const localPath = await this.settings.resolveBrandLogoLocalPath();
      if (!localPath) return pipeline;

      const maxW = 168;
      const maxH = 72;
      const logo = await sharp(localPath)
        .rotate()
        .resize(maxW, maxH, { fit: 'inside', withoutEnlargement: true })
        .png()
        .toBuffer();

      const meta = await sharp(logo).metadata();
      const lw = meta.width ?? maxW;
      const lh = meta.height ?? maxH;
      // گوشه پایین-راست — مثل استوری فروشگاهی استاندارد
      const left = Math.max(24, width - lw - 48);
      const top = Math.max(24, height - lh - 56);

      return pipeline.composite([{ input: logo, top, left }]);
    } catch (err) {
      this.logger.warn(
        `Brand logo overlay skipped: ${String((err as Error).message)}`,
      );
      return pipeline;
    }
  }

  private sanitizeDisplayText(value: string, maxLen: number): string {
    return String(value ?? '')
      .replace(/<[^>]*>/g, ' ')
      .replace(/[\u0000-\u001F\u007F]/g, ' ')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, maxLen);
  }

  private escapeXml(value: string): string {
    return value
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }
}
