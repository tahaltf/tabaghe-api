import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../../infrastructure/prisma/prisma.service';
import {
  seedPlatformContent,
  type PlatformContentSeedOptions,
  type PlatformContentSeedResult,
} from '../../../common/content/platform-content.seed';

@Injectable()
export class AdminPlatformContentService {
  private readonly logger = new Logger(AdminPlatformContentService.name);

  constructor(private readonly prisma: PrismaService) {}

  async seedDefaults(
    options: PlatformContentSeedOptions,
    actorUserId: string,
  ): Promise<PlatformContentSeedResult> {
    const result = await seedPlatformContent(this.prisma, options);
    this.logger.log(
      `Platform content seed by GODADMIN ${actorUserId}: settings=${result.settings.map((s) => `${s.key}:${s.action}`).join(',')} faqs=${result.faqs.action}`,
    );
    return result;
  }
}
