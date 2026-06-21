import { Controller, Get } from '@nestjs/common';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { RawResponse } from '../../common/decorators/raw-response.decorator';
import { buildSmsWebOtpTemplateGuide } from '../../common/sms/web-otp-template.util';
import { SELLER_LANDING_SECTION_COUNT } from '../../common/landing/seller-landing.seed';

@Controller('health')
export class HealthController {
  constructor(private readonly prisma: PrismaService) {}

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

  @Get('ops-checklist')
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
