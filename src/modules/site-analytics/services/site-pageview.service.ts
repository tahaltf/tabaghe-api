import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../../infrastructure/prisma/prisma.service';
import { RecordPageviewDto } from '../dto/pageview.dto';

const VIEW_DEDUP_MS = 30 * 1000;
const ADMIN_PATH_RE = /^\/admin(\/|$)/i;

@Injectable()
export class SitePageviewService {
  constructor(private readonly prisma: PrismaService) {}

  async record(
    dto: RecordPageviewDto,
    userId?: string,
    userAgent?: string,
  ): Promise<{ ok: true; skipped?: boolean }> {
    const path = this.normalizePath(dto.path);
    if (!path || ADMIN_PATH_RE.test(path)) {
      return { ok: true, skipped: true };
    }

    const sessionId = dto.sessionId.trim().slice(0, 80);
    if (!sessionId) {
      return { ok: true, skipped: true };
    }

    const since = new Date(Date.now() - VIEW_DEDUP_MS);
    const existing = await this.prisma.sitePageView.findFirst({
      where: {
        sessionId,
        path,
        viewedAt: { gte: since },
      },
      select: { id: true },
    });
    if (existing) {
      return { ok: true, skipped: true };
    }

    const now = new Date();
    const device = this.classifyDevice(userAgent);

    await this.prisma.siteSession.upsert({
      where: { id: sessionId },
      create: {
        id: sessionId,
        userId: userId ?? null,
        firstSeenAt: now,
        lastSeenAt: now,
        landingPath: path,
        referrer: dto.referrer?.slice(0, 2000) || null,
        utmSource: dto.utmSource?.slice(0, 200) || null,
        utmMedium: dto.utmMedium?.slice(0, 200) || null,
        utmCampaign: dto.utmCampaign?.slice(0, 200) || null,
        device,
      },
      update: {
        lastSeenAt: now,
        ...(userId ? { userId } : {}),
      },
    });

    await this.prisma.sitePageView.create({
      data: {
        sessionId,
        userId: userId ?? null,
        path,
        title: dto.title?.slice(0, 500) || null,
        referrer: dto.referrer?.slice(0, 2000) || null,
        viewedAt: now,
      },
    });

    return { ok: true };
  }

  private normalizePath(raw: string): string {
    const trimmed = (raw || '').trim();
    if (!trimmed) return '';
    try {
      if (trimmed.startsWith('http://') || trimmed.startsWith('https://')) {
        const u = new URL(trimmed);
        return (u.pathname || '/').split('?')[0].split('#')[0] || '/';
      }
    } catch {
      /* ignore */
    }
    const path = trimmed.split('?')[0].split('#')[0];
    if (!path.startsWith('/')) return `/${path}`;
    return path.slice(0, 2000);
  }

  private classifyDevice(ua?: string): string | null {
    if (!ua) return null;
    if (/bot|crawl|spider|slurp|facebookexternalhit/i.test(ua)) return 'bot';
    if (/Mobile|Android|iPhone|iPad|iPod/i.test(ua)) return 'mobile';
    if (/Tablet|iPad/i.test(ua)) return 'tablet';
    return 'desktop';
  }
}
