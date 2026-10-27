import {
  Controller,
  Get,
  Header,
  Post,
  Query,
  Res,
  UseGuards,
} from '@nestjs/common';
import { UserRole } from '@prisma/client';
import type { Response } from 'express';
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../../auth/guards/roles.guard';
import { PermissionsGuard } from '../../auth/guards/permissions.guard';
import { Roles } from '../../auth/decorators/roles.decorator';
import { RequirePermission } from '../../auth/decorators/require-permission.decorator';
import { SiteAnalyticsQueryService } from '../services/site-analytics-query.service';
import { SiteAnalyticsRollupService } from '../services/site-analytics-rollup.service';
import { GscSyncService } from '../services/gsc-sync.service';
import { SiteAnalyticsIntelligenceService } from '../services/site-analytics-intelligence.service';

@Controller('admin/site-analytics')
@UseGuards(JwtAuthGuard, RolesGuard, PermissionsGuard)
@Roles(UserRole.ADMIN)
@RequirePermission('site_analytics.view')
export class AdminSiteAnalyticsController {
  constructor(
    private readonly query: SiteAnalyticsQueryService,
    private readonly rollup: SiteAnalyticsRollupService,
    private readonly gscSync: GscSyncService,
    private readonly intelligence: SiteAnalyticsIntelligenceService,
  ) {}

  @Get('overview')
  overview(@Query('from') from?: string, @Query('to') to?: string) {
    return this.query.getOverview(from, to);
  }

  @Get('site/timeseries')
  siteTimeseries(@Query('from') from?: string, @Query('to') to?: string) {
    return this.query.getSiteTimeseries(from, to);
  }

  @Get('site/pages')
  sitePages(
    @Query('from') from?: string,
    @Query('to') to?: string,
    @Query('q') q?: string,
    @Query('sort') sort?: string,
    @Query('sortDir') sortDir?: string,
    @Query('limit') limit?: string,
  ) {
    return this.query.getSitePages({
      from,
      to,
      q,
      sort,
      sortDir,
      limit: limit ? Number(limit) : undefined,
    });
  }

  @Get('site/listings')
  siteListings(
    @Query('from') from?: string,
    @Query('to') to?: string,
    @Query('q') q?: string,
    @Query('limit') limit?: string,
  ) {
    return this.query.getSiteListings({
      from,
      to,
      q,
      limit: limit ? Number(limit) : undefined,
    });
  }

  @Get('gsc/overview')
  gscOverview(@Query('from') from?: string, @Query('to') to?: string) {
    return this.query.getGscOverview(from, to);
  }

  @Get('gsc/timeseries')
  gscTimeseries(@Query('from') from?: string, @Query('to') to?: string) {
    return this.query.getGscTimeseries(from, to);
  }

  @Get('gsc/pages')
  gscPages(
    @Query('from') from?: string,
    @Query('to') to?: string,
    @Query('q') q?: string,
    @Query('sort') sort?: string,
    @Query('sortDir') sortDir?: string,
    @Query('limit') limit?: string,
  ) {
    return this.query.getGscPages({
      from,
      to,
      q,
      sort,
      sortDir,
      limit: limit ? Number(limit) : undefined,
    });
  }

  @Get('gsc/queries')
  gscQueries(
    @Query('from') from?: string,
    @Query('to') to?: string,
    @Query('q') q?: string,
    @Query('sort') sort?: string,
    @Query('sortDir') sortDir?: string,
    @Query('limit') limit?: string,
  ) {
    return this.query.getGscQueries({
      from,
      to,
      q,
      sort,
      sortDir,
      limit: limit ? Number(limit) : undefined,
    });
  }

  @Get('gsc/status')
  gscStatus() {
    return this.gscSync.getStatus();
  }

  @Get('path')
  pathDetail(
    @Query('path') path: string,
    @Query('from') from?: string,
    @Query('to') to?: string,
  ) {
    return this.query.getPathDetail(path || '/', from, to);
  }

  @Get('opportunities')
  opportunities(@Query('from') from?: string, @Query('to') to?: string) {
    return this.intelligence.getOpportunities(from, to);
  }

  @Get('movers')
  movers(@Query('kind') kind?: string) {
    return this.intelligence.getMovers(kind === 'gsc' ? 'gsc' : 'site');
  }

  @Get('decay')
  decay() {
    return this.intelligence.getDecay();
  }

  @Get('issues')
  issues(@Query('thresholdPct') thresholdPct?: string) {
    return this.intelligence.getIssues(
      thresholdPct ? Number(thresholdPct) : 25,
    );
  }

  @Get('export/site-pages.csv')
  @Header('Content-Type', 'text/csv; charset=utf-8')
  async exportSitePages(
    @Res() res: Response,
    @Query('from') from?: string,
    @Query('to') to?: string,
  ) {
    const data = await this.query.getSitePages({ from, to, limit: 500 });
    const lines = ['path,visitors,pageviews'];
    for (const row of data.items) {
      lines.push(
        `"${row.path.replace(/"/g, '""')}",${row.visitors},${row.pageviews}`,
      );
    }
    res.setHeader(
      'Content-Disposition',
      `attachment; filename="site-pages-${data.from}-${data.to}.csv"`,
    );
    res.send('\uFEFF' + lines.join('\n'));
  }

  @Get('export/gsc-pages.csv')
  @Header('Content-Type', 'text/csv; charset=utf-8')
  async exportGscPages(
    @Res() res: Response,
    @Query('from') from?: string,
    @Query('to') to?: string,
  ) {
    const data = await this.query.getGscPages({ from, to, limit: 500 });
    const lines = ['page,clicks,impressions,ctr,position'];
    for (const row of data.items) {
      lines.push(
        `"${row.page.replace(/"/g, '""')}",${row.clicks},${row.impressions},${row.ctr},${row.position}`,
      );
    }
    res.setHeader(
      'Content-Disposition',
      `attachment; filename="gsc-pages-${data.from}-${data.to}.csv"`,
    );
    res.send('\uFEFF' + lines.join('\n'));
  }

  @Get('export/gsc-queries.csv')
  @Header('Content-Type', 'text/csv; charset=utf-8')
  async exportGscQueries(
    @Res() res: Response,
    @Query('from') from?: string,
    @Query('to') to?: string,
  ) {
    const data = await this.query.getGscQueries({ from, to, limit: 500 });
    const lines = ['query,clicks,impressions,ctr,position'];
    for (const row of data.items) {
      lines.push(
        `"${row.query.replace(/"/g, '""')}",${row.clicks},${row.impressions},${row.ctr},${row.position}`,
      );
    }
    res.setHeader(
      'Content-Disposition',
      `attachment; filename="gsc-queries-${data.from}-${data.to}.csv"`,
    );
    res.send('\uFEFF' + lines.join('\n'));
  }

  @Post('rollup')
  @RequirePermission('site_analytics.update')
  async runRollup(
    @Query('from') from?: string,
    @Query('to') to?: string,
  ) {
    const range = this.query.resolveRange(from, to);
    const days = await this.rollup.rollupRange(range.from, range.to);
    await this.rollup.purgeOldRaw();
    return { ok: true, days };
  }

  @Post('gsc/verify')
  @RequirePermission('site_analytics.update')
  verifyGsc() {
    return this.gscSync.verifyAndConnect();
  }

  @Post('gsc/sync')
  @RequirePermission('site_analytics.update')
  syncGsc(@Query('days') days?: string) {
    return this.gscSync.syncRecent(days ? Number(days) : 28);
  }
}
