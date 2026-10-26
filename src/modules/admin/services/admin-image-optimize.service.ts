import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../../infrastructure/prisma/prisma.service';
import type { OptimizeDirectorySummary } from '../../../common/upload/image-optimize.service';
import { mergeHomepageLayout } from '../../../common/homepage/homepage-layout.util';
import { AdminSettingsService, SETTING_KEYS } from './admin-settings.service';

@Injectable()
export class AdminImageOptimizeService {
  private readonly logger = new Logger(AdminImageOptimizeService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly settings: AdminSettingsService,
  ) {}

  /**
   * Point known settings / homepage layout at newly generated `.webp` files.
   * Uses settings setters so public caches invalidate correctly.
   */
  async remapOptimizedFilenames(
    summaries: OptimizeDirectorySummary[],
  ): Promise<{ updated: number; details: string[] }> {
    const renameMap = new Map<string, string>();
    for (const summary of summaries) {
      for (const row of summary.results) {
        if (row.skipped || row.error) continue;
        if (!row.source || row.source === row.filename) continue;
        renameMap.set(row.source, row.filename);
        renameMap.set(`banners/${row.source}`, `banners/${row.filename}`);
        renameMap.set(`brand/${row.source}`, `brand/${row.filename}`);
      }
    }

    if (!renameMap.size) {
      return { updated: 0, details: [] };
    }

    const details: string[] = [];
    let updated = 0;

    const banner = await this.prisma.systemSetting.findUnique({
      where: { key: SETTING_KEYS.HOMEPAGE_BANNER },
    });
    if (banner?.value && renameMap.has(banner.value)) {
      const next = renameMap.get(banner.value)!;
      await this.settings.setBanner(next);
      details.push(`HOMEPAGE_BANNER: ${banner.value} → ${next}`);
      updated += 1;
    }

    const brandSetters: Array<{
      key: string;
      set: (filename: string) => Promise<unknown>;
    }> = [
      {
        key: SETTING_KEYS.MEDIA_FALLBACK_LOGO,
        set: (f) => this.settings.setMediaFallbackLogo(f),
      },
      {
        key: SETTING_KEYS.USER_APP_LOGO,
        set: (f) => this.settings.setUserAppLogo(f),
      },
      {
        key: SETTING_KEYS.USER_APP_LOGO_LIGHT,
        set: (f) => this.settings.setUserAppLogoLight(f),
      },
      {
        key: SETTING_KEYS.USER_APP_LOGO_DARK,
        set: (f) => this.settings.setUserAppLogoDark(f),
      },
      {
        key: SETTING_KEYS.PWA_APP_ICON,
        set: (f) => this.settings.setPwaAppIcon(f),
      },
      {
        key: SETTING_KEYS.PWA_APP_FAVICON,
        set: (f) => this.settings.setPwaAppFavicon(f),
      },
      {
        key: SETTING_KEYS.ADMIN_PANEL_LOGO,
        set: (f) => this.settings.setAdminPanelLogo(f),
      },
    ];

    for (const entry of brandSetters) {
      const row = await this.prisma.systemSetting.findUnique({
        where: { key: entry.key },
      });
      if (!row?.value || !renameMap.has(row.value)) continue;
      const next = renameMap.get(row.value)!;
      await entry.set(next);
      details.push(`${entry.key}: ${row.value} → ${next}`);
      updated += 1;
    }

    const layoutRow = await this.prisma.systemSetting.findUnique({
      where: { key: SETTING_KEYS.HOMEPAGE_LAYOUT },
    });
    if (layoutRow?.value) {
      let raw = layoutRow.value;
      let changed = false;
      for (const [from, to] of renameMap) {
        if (raw.includes(from)) {
          raw = raw.split(from).join(to);
          changed = true;
        }
      }
      if (changed) {
        let parsed: unknown = raw;
        try {
          parsed = JSON.parse(raw);
        } catch {
          parsed = raw;
        }
        const layout = mergeHomepageLayout(parsed);
        await this.settings.upsertHomepageLayout(layout);
        details.push('HOMEPAGE_LAYOUT: visual/media paths remapped');
        updated += 1;
      }
    }

    if (updated) {
      this.logger.log(`Remapped ${updated} setting(s) after image optimize`);
    }
    return { updated, details };
  }
}
