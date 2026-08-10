import {
  Body,
  Controller,
  ForbiddenException,
  Get,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { SkipThrottle } from '@nestjs/throttler';
import { UserRole } from '@prisma/client';
import type { Request } from 'express';
import { IsOptional, IsString, MaxLength } from 'class-validator';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { RawResponse } from '../../common/decorators/raw-response.decorator';
import { buildSmsWebOtpTemplateGuide } from '../../common/sms/web-otp-template.util';
import { SELLER_LANDING_SECTION_COUNT } from '../../common/landing/seller-landing.seed';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { SmsService } from '../sms/sms.service';

class DeploySmsAlertDto {
  @IsString()
  @MaxLength(40)
  status!: string;

  @IsOptional()
  @IsString()
  @MaxLength(120)
  detail?: string;
}

@Controller('health')
export class HealthController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly sms: SmsService,
    private readonly config: ConfigService,
  ) {}

  @Get()
  @RawResponse()
  async health() {
    await this.prisma.$queryRaw`SELECT 1`;

    return {
      ok: true,
      status: 'up',
      time: new Date().toISOString(),
    };
  }

  /**
   * فراخوانی از post-deploy-verify.sh (معمولاً داخل کانتینر روی localhost).
   * تنظیمات قالب/گیرنده از پنل ادمین خوانده می‌شود.
   *
   * localhost همیشه مجاز است (docker exec)، حتی اگر DEPLOY_NOTIFY_TOKEN ست باشد —
   * توکن فقط برای فراخوانی غیرمحلی (مثلاً از طریق gateway) لازم است.
   */
  @Post('deploy-sms-alert')
  @SkipThrottle()
  @RawResponse()
  async deploySmsAlert(@Body() dto: DeploySmsAlertDto, @Req() req: Request) {
    this.assertDeployNotifyAllowed(req);

    const result = await this.sms.sendDeployAlert(
      dto.status,
      dto.detail?.trim() || '',
    );

    return {
      ok: result.sent > 0,
      ...result,
    };
  }

  /**
   * فراخوانی از uptime-monitor.sh (قطع/وصل دسترس‌پذیری).
   * قالب همان STATUS/DETAIL دیپلوی؛ فعال‌سازی با SMS_UPTIME_ALERT_ENABLED.
   */
  @Post('uptime-sms-alert')
  @SkipThrottle()
  @RawResponse()
  async uptimeSmsAlert(@Body() dto: DeploySmsAlertDto, @Req() req: Request) {
    this.assertDeployNotifyAllowed(req);

    const result = await this.sms.sendUptimeAlert(
      dto.status,
      dto.detail?.trim() || '',
    );

    return {
      ok: result.sent > 0,
      ...result,
    };
  }

  private assertDeployNotifyAllowed(req: Request): void {
    // Prefer socket peer (not req.ip): trust proxy + X-Forwarded-For must not
    // fake "localhost", and docker-exec → 127.0.0.1 must always pass.
    const remote = String(req.socket?.remoteAddress || '')
      .replace(/^::ffff:/, '')
      .trim();
    if (remote === '127.0.0.1' || remote === '::1') {
      return;
    }

    const token = this.config.get<string>('DEPLOY_NOTIFY_TOKEN')?.trim();
    const header = String(
      req.headers['x-deploy-notify-token'] ?? '',
    ).trim();
    if (token && header === token) {
      return;
    }

    throw new ForbiddenException(
      'این endpoint فقط از localhost یا با DEPLOY_NOTIFY_TOKEN قابل فراخوانی است',
    );
  }

  @Get('ops-checklist')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.GODADMIN)
  @RawResponse()
  opsChecklist() {
    const sms = buildSmsWebOtpTemplateGuide();
    return {
      deploy: {
        dbMigrations: [
          '20260621120000_listing_composite_indexes',
          '20260621140000_campaign_link_ab_split',
          '20260621160000_listing_scale_indexes',
        ],
        env: ['REDIS_URL', 'PRISMA_CONNECTION_LIMIT or PgBouncer URL', 'JWT_SECRET', 'FRONTEND_ORIGINS'],
        scripts: ['npm run db:deploy', 'npm run seed:seller-landing -- --force'],
        multiReplica: 'All API instances need shared REDIS_URL for Throttler, Socket.io, and TTL cache.',
      },
      improvementPlanPhase1: {
        smsWebOtp: sms,
        sellerLanding: {
          slug: 'seller',
          expectedSectionCount: SELLER_LANDING_SECTION_COUNT,
          adminEndpoint: 'POST /api/v1/admin/landing-pages/seed-seller',
          cli: 'npm run seed:seller-landing',
        },
        manualQa: [
          'Listing-detail spacing + breadcrumb (mobile/desktop).',
          'Province modal on /listings + preference persistence.',
          'Chrome Android OTP on /auth and /seller.',
          'Seller landing mockup + A/B /ref/seller-jom.',
          'Listings pagination (24/page) + suggest autocomplete.',
        ],
        stagingEnvFiles: ['tabaghe-api/.env.staging.example', 'tabaghe-frontend/.env.staging.example'],
      },
      acceptance: {
        lighthouseMobileSeller: '>= 80',
        loadTest: '100 RPS, p95 < 500ms',
        smokeTestMinutes: 30,
      },
    };
  }
}
