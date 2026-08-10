import { Injectable, Logger } from '@nestjs/common';
import { createReadStream, existsSync, mkdirSync, writeFileSync } from 'fs';
import { join } from 'path';
import sharp = require('sharp');
import { AiContentSettingsService } from '../services/ai-content-settings.service';
import type { StoryGenerationInput } from '../utils/story-prompt.builder';
import { buildStoryImagePrompt } from '../utils/story-prompt.builder';
import { AI_CONTENT_UPLOAD_DIR } from '../ai-content.constants';

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
    const prompt = buildStoryImagePrompt(params.input);

    if (apiKey) {
      try {
        const aiBuffer = await this.tryOpenAiEdit({
          apiKey,
          model,
          prompt,
          productImagePath: params.productImagePath,
        });
        if (aiBuffer) {
          const withBrand = await this.applyBrandOverlay(aiBuffer);
          return { buffer: withBrand, provider: 'liara', model };
        }
        this.logger.warn(
          `Liara image edit returned empty result for model=${model}; using Sharp fallback`,
        );
      } catch (err) {
        this.logger.warn(
          `Liara image edit failed, using Sharp fallback: ${String((err as Error).message)}`,
        );
      }
    } else {
      this.logger.warn('No Liara/OpenAI API key configured; using Sharp fallback');
    }

    try {
      const buffer = await this.composeFallbackStory({
        productImagePath: params.productImagePath,
        title: params.input.listingTitle,
        caption: params.caption,
        priceLabel: params.input.priceLabel,
      });
      return { buffer, provider: 'sharp-fallback', model: 'local-compose' };
    } catch (err) {
      this.logger.error(
        `Sharp fallback failed: ${String((err as Error).message)}`,
        err instanceof Error ? err.stack : undefined,
      );
      throw new Error(
        `ساخت تصویر استوری ناموفق بود: ${String((err as Error).message ?? err)}`,
      );
    }
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

  private async tryOpenAiEdit(params: {
    apiKey: string;
    model: string;
    prompt: string;
    productImagePath: string;
  }): Promise<Buffer | null> {
    const baseUrl = this.settings.getOpenAiBaseUrl();
    const imageBuffer = await sharp(params.productImagePath)
      .rotate()
      .resize(1024, 1024, { fit: 'inside', withoutEnlargement: true })
      .png()
      .toBuffer();

    const form = new FormData();
    form.append('model', params.model);
    form.append('prompt', params.prompt.slice(0, 3500));
    form.append(
      'image',
      new Blob([new Uint8Array(imageBuffer)], { type: 'image/png' }),
      'product.png',
    );
    form.append('size', '1024x1536');

    // سقف کوتاه‌تر از تایم‌اوت رایج پروکسی (۶۰s) تا قبل از 504 به Sharp برگردیم
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 45_000);
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
        this.logger.warn('Liara image edit timed out after 45s');
        return null;
      }
      throw err;
    } finally {
      clearTimeout(timer);
    }

    if (!res.ok) {
      const body = await res.text();
      this.logger.warn(`Liara image edit failed: ${res.status} ${body}`);
      return null;
    }

    const data = (await res.json()) as {
      data?: Array<{ b64_json?: string; url?: string }>;
    };
    const item = data.data?.[0];
    if (item?.b64_json) {
      return Buffer.from(item.b64_json, 'base64');
    }
    if (item?.url) {
      const imgRes = await fetch(item.url, {
        signal: AbortSignal.timeout(20_000),
      });
      if (!imgRes.ok) return null;
      return Buffer.from(await imgRes.arrayBuffer());
    }
    return null;
  }

  private async composeFallbackStory(params: {
    productImagePath: string;
    title: string;
    caption: string;
    priceLabel?: string | null;
  }): Promise<Buffer> {
    const width = 1080;
    const height = 1920;

    const gradientSvg = `
      <svg width="${width}" height="${height}">
        <defs>
          <linearGradient id="g" x1="0" y1="0" x2="1" y2="1">
            <stop offset="0%" stop-color="#0f172a"/>
            <stop offset="100%" stop-color="#1e3a5f"/>
          </linearGradient>
        </defs>
        <rect width="100%" height="100%" fill="url(#g)"/>
      </svg>`;

    const product = await sharp(params.productImagePath)
      .rotate()
      .resize(760, 760, {
        fit: 'contain',
        background: { r: 0, g: 0, b: 0, alpha: 0 },
      })
      .png()
      .toBuffer();

    const title = this.escapeXml(this.sanitizeDisplayText(params.title, 48));
    const price = params.priceLabel
      ? this.escapeXml(this.sanitizeDisplayText(params.priceLabel, 40))
      : '';
    const subtitle = this.escapeXml(
      this.sanitizeDisplayText(params.caption, 90),
    );

    const textSvg = `
      <svg width="${width}" height="${height}">
        <style>
          .title { fill: #fff; font-size: 52px; font-family: Arial, sans-serif; font-weight: 700; }
          .price { fill: #fbbf24; font-size: 40px; font-family: Arial, sans-serif; font-weight: 600; }
          .sub { fill: #e2e8f0; font-size: 30px; font-family: Arial, sans-serif; }
          .brand { fill: #94a3b8; font-size: 26px; font-family: Arial, sans-serif; }
        </style>
        <text x="60" y="1500" class="title">${title}</text>
        ${price ? `<text x="60" y="1565" class="price">${price}</text>` : ''}
        ${subtitle ? `<text x="60" y="1640" class="sub">${subtitle}</text>` : ''}
        <text x="60" y="1860" class="brand">Tabagheh</text>
      </svg>`;

    let pipeline = sharp(Buffer.from(gradientSvg))
      .resize(width, height)
      .composite([
        { input: product, top: 280, left: 160 },
        { input: Buffer.from(textSvg), top: 0, left: 0 },
      ]);

    pipeline = await this.overlayBrandLogo(pipeline, width, height);
    return pipeline.png().toBuffer();
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
      const logoUrl = await this.settings.getBrandLogoUrl();
      if (!logoUrl) return pipeline;

      const localPath = logoUrl.startsWith('/uploads/')
        ? `.${logoUrl}`
        : logoUrl.replace(/^https?:\/\/[^/]+/, '.');
      if (!existsSync(localPath)) return pipeline;

      const logo = await sharp(localPath)
        .rotate()
        .resize(140, 140, { fit: 'inside' })
        .png()
        .toBuffer();

      return pipeline.composite([
        { input: logo, top: height - 180, left: width - 180 },
      ]);
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
