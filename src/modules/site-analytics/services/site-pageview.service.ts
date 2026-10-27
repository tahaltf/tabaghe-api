import { Injectable } from '@nestjs/common';
import { UserRole } from '@prisma/client';
import { PrismaService } from '../../../infrastructure/prisma/prisma.service';
import { RecordPageviewDto } from '../dto/pageview.dto';

const VIEW_DEDUP_MS = 30 * 1000;
const ADMIN_PATH_RE = /^\/admin(\/|$)/i;

/** Crawlers, link-preview fetchers, SEO tools, monitors and headless/automation browsers. */
const NON_HUMAN_UA_RE =
  /bot|crawl|spider|slurp|scrap|fetch|preview|externalhit|externalagent|inspection|lighthouse|pagespeed|gtmetrix|pingdom|uptime|monitor|statuscake|headless|phantom|puppeteer|playwright|selenium|webdriver|python|curl|wget|httpclient|http-client|axios|node-fetch|undici|java\/|go-http|okhttp|postman|insomnia|whatsapp|yandex|baidu|bytespider|petal|semrush|ahrefs|mj12|dataforseo|seznam|qwant|duckduck|applebot|mediapartners|adsbot|apis-google|feedfetcher/i;

const STAFF_ROLES: UserRole[] = [UserRole.ADMIN, UserRole.GODADMIN];

@Injectable()
export class SitePageviewService {
  constructor(private readonly prisma: PrismaService) {}

  async record(
    dto: RecordPageviewDto,
    user?: { id: string; role: UserRole } | null,
    userAgent?: string,
  ): Promise<{ ok: true; skipped?: boolean }> {
    const path = this.normalizePath(dto.path);
    if (!path || ADMIN_PATH_RE.test(path)) {
      return { ok: true, skipped: true };
    }
    // Internal traffic (team browsing the site) and non-human clients are not visits.
    if (!this.isHumanUserAgent(userAgent) || (user && STAFF_ROLES.includes(user.role))) {
      return { ok: true, skipped: true };
    }

    const sessionId = dto.sessionId.trim().slice(0, 80);
    if (!sessionId) {
      return { ok: true, skipped: true };
    }
    const userId = user?.id ?? null;

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

    const session = await this.prisma.siteSession.findUnique({
      where: { id: sessionId },
      select: { userId: true },
    });

    await this.prisma.siteSession.upsert({
      where: { id: sessionId },
      create: {
        id: sessionId,
        userId,
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

    // A guest who logs in is the same visitor: attribute their earlier guest views to the account.
    if (userId && session && !session.userId) {
      await this.prisma.sitePageView.updateMany({
        where: { sessionId, userId: null },
        data: { userId },
      });
    }

    await this.prisma.sitePageView.create({
      data: {
        sessionId,
        userId,
        path,
        title: dto.title?.slice(0, 500) || null,
        referrer: dto.referrer?.slice(0, 2000) || null,
        viewedAt: now,
      },
    });

    return { ok: true };
  }

  private isHumanUserAgent(ua?: string): boolean {
    if (!ua || ua.length < 20) return false;
    if (!/mozilla\//i.test(ua)) return false;
    return !NON_HUMAN_UA_RE.test(ua);
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
    if (/Tablet|iPad/i.test(ua)) return 'tablet';
    if (/Mobile|Android|iPhone|iPod/i.test(ua)) return 'mobile';
    return 'desktop';
  }
}
