import { Injectable } from '@nestjs/common';
import {
  fileMtimeMs,
  renderFaviconFallbackPng,
  renderFaviconPng,
  renderPwaFallbackPng,
  renderPwaIconPng,
} from '../common/pwa-icon-render.util';
import { CommonService } from './common-module.service';

@Injectable()
export class PwaIconService {
  private readonly pngCache = new Map<string, Buffer>();

  constructor(private readonly commonService: CommonService) {}

  async getPngBuffer(size: number): Promise<Buffer> {
    const side = Math.max(48, Math.min(1024, Math.floor(size)));
    const asset = await this.commonService.resolvePwaIconAsset();
    const cacheKey = asset
      ? `${asset.path}:${await fileMtimeMs(asset.path)}:${side}`
      : `fallback:${side}`;
    const hit = this.pngCache.get(cacheKey);
    if (hit) return hit;

    const buf = asset
      ? await renderPwaIconPng(asset.path, side)
      : await renderPwaFallbackPng(side);
    this.pngCache.set(cacheKey, buf);
    if (this.pngCache.size > 24) {
      const first = this.pngCache.keys().next().value;
      if (first) this.pngCache.delete(first);
    }
    return buf;
  }

  async getFaviconPngBuffer(size = 32): Promise<Buffer> {
    const side = Math.max(16, Math.min(512, Math.floor(size)));
    const asset = await this.commonService.resolveFaviconAsset();
    const cacheKey = asset
      ? `favicon:${asset.path}:${await fileMtimeMs(asset.path)}:${side}`
      : `favicon:fallback:${side}`;
    const hit = this.pngCache.get(cacheKey);
    if (hit) return hit;

    const buf = asset
      ? await renderFaviconPng(asset.path, side)
      : await renderFaviconFallbackPng(side);
    this.pngCache.set(cacheKey, buf);
    if (this.pngCache.size > 32) {
      const first = this.pngCache.keys().next().value;
      if (first) this.pngCache.delete(first);
    }
    return buf;
  }

  clearCache(): void {
    this.pngCache.clear();
  }
}
