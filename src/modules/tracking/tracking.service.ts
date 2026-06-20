import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import type { Request } from 'express';
import {
  buildRedirectUrl,
  extractClientIp,
  normalizeQueryParams,
} from './tracking.util';

@Injectable()
export class TrackingService {
  constructor(private readonly prisma: PrismaService) {}

  async handleRedirect(slug: string, req: Request): Promise<string> {
    const link = await this.prisma.campaignLink.findFirst({
      where: { slug, isActive: true },
    });
    if (!link) {
      throw new NotFoundException('لینک یافت نشد');
    }

    const queryParams = normalizeQueryParams(req.query);
    const frontendAppUrl = (
      process.env.FRONTEND_APP_URL || 'https://tabagheh.com'
    ).trim();

    await this.prisma.clickLog.create({
      data: {
        campaignLinkId: link.id,
        ipAddress: extractClientIp(req),
        userAgent: req.headers['user-agent']?.slice(0, 500) ?? null,
        queryParams:
          Object.keys(queryParams).length > 0
            ? (queryParams as Prisma.InputJsonValue)
            : Prisma.JsonNull,
      },
    });

    return buildRedirectUrl(link.targetUrl, queryParams, frontendAppUrl);
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
