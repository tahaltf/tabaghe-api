import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import type { Request } from 'express';
import {
  buildAbSetCookie,
  buildRedirectUrl,
  extractClientIp,
  normalizeQueryParams,
  parseAbCookie,
  pickSplitVariant,
} from './tracking.util';

export interface CampaignRedirectResult {
  url: string;
  setCookie?: string;
}

@Injectable()
export class TrackingService {
  constructor(private readonly prisma: PrismaService) {}

  async handleRedirect(slug: string, req: Request): Promise<CampaignRedirectResult> {
    const entry = await this.prisma.campaignLink.findFirst({
      where: { slug, isActive: true },
    });
    if (!entry) {
      throw new NotFoundException('لینک یافت نشد');
    }

    const queryParams = normalizeQueryParams(req.query);
    const frontendAppUrl = (
      process.env.FRONTEND_APP_URL || 'https://tabagheh.com'
    ).trim();

    let targetUrl = entry.targetUrl;
    let logLinkId = entry.id;
    let setCookie: string | undefined;

    if (entry.splitGroup?.trim()) {
      const group = entry.splitGroup.trim();
      const variants = await this.prisma.campaignLink.findMany({
        where: { splitGroup: group, isActive: true },
        select: { id: true, targetUrl: true, splitWeight: true },
      });
      if (variants.length > 1) {
        const stickyId = parseAbCookie(req.headers.cookie, group);
        const picked = pickSplitVariant(variants, stickyId);
        targetUrl = picked.targetUrl;
        logLinkId = picked.id;
        if (stickyId !== picked.id) {
          setCookie = buildAbSetCookie(group, picked.id);
        }
      }
    }

    const trackingMeta: Record<string, string> = { ...queryParams };
    if (entry.splitGroup?.trim()) {
      trackingMeta['abGroup'] = entry.splitGroup.trim();
      if (logLinkId !== entry.id) {
        trackingMeta['abEntrySlug'] = entry.slug;
        trackingMeta['abVariantId'] = logLinkId;
      }
    }

    await this.prisma.clickLog.create({
      data: {
        campaignLinkId: logLinkId,
        ipAddress: extractClientIp(req),
        userAgent: req.headers['user-agent']?.slice(0, 500) ?? null,
        queryParams:
          Object.keys(trackingMeta).length > 0
            ? (trackingMeta as Prisma.InputJsonValue)
            : Prisma.JsonNull,
      },
    });

    const url = buildRedirectUrl(targetUrl, queryParams, frontendAppUrl);
    return { url, setCookie };
  }

  async getHourlyClickStats(campaignLinkId: string, days = 7) {
    await this.ensureLinkExists(campaignLinkId);

    const since = new Date();
    since.setHours(0, 0, 0, 0);
    since.setDate(since.getDate() - (days - 1));

    const rows = await this.prisma.$queryRaw<
      Array<{ hour: Date; count: bigint }>
    >`
      SELECT date_trunc('hour', "clickedAt") AS hour, COUNT(*)::bigint AS count
      FROM "ClickLog"
      WHERE "campaignLinkId" = ${campaignLinkId}
        AND "clickedAt" >= ${since}
      GROUP BY 1
      ORDER BY 1 ASC
    `;

    return rows.map((row) => ({
      hour: row.hour.toISOString(),
      count: Number(row.count),
    }));
  }

  private async ensureLinkExists(id: string) {
    const row = await this.prisma.campaignLink.findUnique({ where: { id } });
    if (!row) throw new NotFoundException('لینک کمپین یافت نشد');
    return row;
  }

  async assertSlugAvailable(slug: string, excludeId?: string) {
    const existing = await this.prisma.campaignLink.findUnique({
      where: { slug },
    });
    if (existing && existing.id !== excludeId) {
      throw new ConflictException('این slug قبلاً استفاده شده است');
    }
  }
}
