import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AdminLandingPagesService } from '../services/admin-landing-pages.service';

@Injectable()
export class SellerLandingBootstrapService implements OnModuleInit {
  private readonly logger = new Logger(SellerLandingBootstrapService.name);

  constructor(
    private readonly landingPages: AdminLandingPagesService,
    private readonly configService: ConfigService,
  ) {}

  async onModuleInit(): Promise<void> {
    const autoSeed =
      this.configService.get<string>('SELLER_LANDING_AUTO_SEED') === 'true' ||
      this.configService.get<string>('NODE_ENV') !== 'production';

    if (!autoSeed) return;

    try {
      const force =
        this.configService.get<string>('SELLER_LANDING_FORCE_SEED') === 'true';
      const sellerResult = await this.landingPages.seedSellerLanding(force);
      this.logger.log(
        `Seller landing seed: ${sellerResult.action} slug=${sellerResult.slug} sections=${sellerResult.sectionCount}`,
      );

      const inviteResult = await this.landingPages.seedInviteLanding(force);
      this.logger.log(
        `Invite landing seed: ${inviteResult.action} slug=${inviteResult.slug} sections=${inviteResult.sectionCount}`,
      );
    } catch (error) {
      this.logger.warn(
        `Seller landing seed skipped: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }
}
