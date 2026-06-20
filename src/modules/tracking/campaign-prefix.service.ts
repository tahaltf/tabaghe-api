import { Injectable, OnModuleInit } from '@nestjs/common';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import {
  DEFAULT_CAMPAIGN_URL_PREFIX,
  isAllowedCampaignPrefix,
  normalizeCampaignUrlPrefix,
} from '../../common/campaign/campaign-url.util';

@Injectable()
export class CampaignPrefixService implements OnModuleInit {
  private prefix = DEFAULT_CAMPAIGN_URL_PREFIX;

  constructor(private readonly prisma: PrismaService) {}

  async onModuleInit(): Promise<void> {
    await this.refresh();
  }

  async refresh(): Promise<void> {
    try {
      const row = await this.prisma.systemSetting.findUnique({
        where: { key: 'CAMPAIGN_LINK_URL_PREFIX' },
        select: { value: true },
      });
      this.prefix = normalizeCampaignUrlPrefix(row?.value);
    } catch {
      this.prefix = DEFAULT_CAMPAIGN_URL_PREFIX;
    }
  }

  getPrefix(): string {
    return this.prefix;
  }

  isAllowedPrefix(prefix: string): boolean {
    return isAllowedCampaignPrefix(prefix, this.prefix);
  }

  getRoutePrefixes(): string[] {
    return [...new Set(['ref', this.prefix])];
  }
}
