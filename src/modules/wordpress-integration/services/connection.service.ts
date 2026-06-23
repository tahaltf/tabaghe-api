import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../../infrastructure/prisma/prisma.service';
import { WordPressPingDto } from '../dto/wordpress-ping.dto';

const CONNECTION_TTL_MS = 10 * 60 * 1000;

export interface WordPressConnectionStatus {
  connected: boolean;
  lastPingAt: Date | null;
  lastSyncAt: Date | null;
  siteUrl: string | null;
  pluginVersion: string | null;
  catalogReady: boolean;
}

@Injectable()
export class WordPressConnectionService {
  constructor(private readonly prisma: PrismaService) {}

  async ping(userId: string, dto: WordPressPingDto): Promise<void> {
    await this.prisma.wordPressConnection.upsert({
      where: { userId },
      create: {
        userId,
        siteUrl: dto.siteUrl,
        pluginVersion: dto.pluginVersion ?? null,
        catalogSecret: dto.catalogSecret ?? null,
        lastPingAt: new Date(),
      },
      update: {
        siteUrl: dto.siteUrl,
        pluginVersion: dto.pluginVersion ?? null,
        ...(dto.catalogSecret ? { catalogSecret: dto.catalogSecret } : {}),
        lastPingAt: new Date(),
      },
    });
  }

  async touchSync(userId: string): Promise<void> {
    await this.prisma.wordPressConnection.upsert({
      where: { userId },
      create: {
        userId,
        lastSyncAt: new Date(),
      },
      update: {
        lastSyncAt: new Date(),
      },
    });
  }

  async recordProductActivity(userId: string, siteUrl: string): Promise<void> {
    await this.prisma.wordPressConnection.upsert({
      where: { userId },
      create: {
        userId,
        siteUrl,
        lastSyncAt: new Date(),
      },
      update: {
        siteUrl,
        lastSyncAt: new Date(),
      },
    });
  }

  async getStatus(userId: string): Promise<WordPressConnectionStatus> {
    const row = await this.prisma.wordPressConnection.findUnique({
      where: { userId },
    });
    if (!row) {
      return {
        connected: false,
        lastPingAt: null,
        lastSyncAt: null,
        siteUrl: null,
        pluginVersion: null,
        catalogReady: false,
      };
    }

    const connected =
      row.lastPingAt != null &&
      Date.now() - row.lastPingAt.getTime() < CONNECTION_TTL_MS;

    return {
      connected,
      lastPingAt: row.lastPingAt,
      lastSyncAt: row.lastSyncAt,
      siteUrl: row.siteUrl,
      pluginVersion: row.pluginVersion,
      catalogReady: Boolean(row.catalogSecret && row.siteUrl),
    };
  }
}
