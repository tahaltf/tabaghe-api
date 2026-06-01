import {
  Injectable,
} from '@nestjs/common';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';

import {
  buildPwaManifestDocument,
  getFrontendAppOrigin,
  getPwaAppIconFilename,
  getPwaFaviconFilename,
  getPwaAppName,
  getPwaAppShortName,
  mimeForBrandFilename,
  resolveBrandLogoAbsolutePath,
  resolveDefaultFaviconPath,
  resolveDefaultPwaAppIconPath,
} from '../../common/pwa-brand-icon.util';

@Injectable()
export class CommonPwaService {
  constructor(private readonly prisma: PrismaService) {}

  async buildPwaManifest(): Promise<Record<string, unknown>> {
    const name = await getPwaAppName(this.prisma);
    const shortName = await getPwaAppShortName(this.prisma);
    return buildPwaManifestDocument(name, shortName, true);
  }

  async resolvePwaIconAsset(): Promise<{ path: string; mime: string } | null> {
    const filename = await getPwaAppIconFilename(this.prisma);
    if (filename) {
      const path = resolveBrandLogoAbsolutePath(filename);
      if (path) return { path, mime: mimeForBrandFilename(filename) };
    }
    const fallback = resolveDefaultPwaAppIconPath();
    return fallback ? { path: fallback, mime: 'image/png' } : null;
  }

  async resolveFaviconAsset(): Promise<{ path: string; mime: string } | null> {
    const filename = await getPwaFaviconFilename(this.prisma);
    if (filename) {
      const path = resolveBrandLogoAbsolutePath(filename);
      if (path) return { path, mime: mimeForBrandFilename(filename) };
    }
    const fallback = resolveDefaultFaviconPath();
    return fallback ? { path: fallback, mime: 'image/png' } : null;
  }

  async getPushIconMeta(): Promise<{ url: string; raster: boolean }> {
    const origin = getFrontendAppOrigin();
    return {
      url: `${origin}/pwa/icon-512.png`,
      raster: true,
    };
  }
}
