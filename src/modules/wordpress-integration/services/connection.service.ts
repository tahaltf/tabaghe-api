import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../../../infrastructure/prisma/prisma.service';
import { WordPressPingDto } from '../dto/wordpress-ping.dto';
import {
  normalizeMinStockForAvailable,
  WORDPRESS_SYNC_INTERVAL_HOURS,
} from '../../../common/utils/min-stock-threshold.util';

const CONNECTION_TTL_MS = 10 * 60 * 1000;

export interface WordPressConnectionStatus {
  connected: boolean;
  lastPingAt: Date | null;
  lastSyncAt: Date | null;
  siteUrl: string | null;
  pluginVersion: string | null;
  catalogReady: boolean;
  syncIntervalHours: number;
  minStockForAvailable: number;
}

export interface WordPressSyncPolicyView {
  userId: string;
  syncIntervalHours: number;
  minStockForAvailable: number;
  connected: boolean;
  lastPingAt: Date | null;
  lastSyncAt: Date | null;
  siteUrl: string | null;
  pluginVersion: string | null;
  catalogReady: boolean;
}

export interface WordPressPingResult {
  ok: true;
  syncIntervalHours: number;
  minStockForAvailable: number;
}

@Injectable()
export class WordPressConnectionService {
  constructor(private readonly prisma: PrismaService) {}

  async ping(userId: string, dto: WordPressPingDto): Promise<WordPressPingResult> {
    const row = await this.prisma.wordPressConnection.upsert({
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

    return {
      ok: true,
      syncIntervalHours: row.syncIntervalHours ?? 12,
      minStockForAvailable: row.minStockForAvailable ?? 1,
    };
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

  async getMinStockForAvailable(userId: string): Promise<number> {
    const row = await this.prisma.wordPressConnection.findUnique({
      where: { userId },
      select: { minStockForAvailable: true },
    });
    return normalizeMinStockForAvailable(row?.minStockForAvailable ?? 1);
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
        syncIntervalHours: 12,
        minStockForAvailable: 1,
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
      syncIntervalHours: row.syncIntervalHours ?? 12,
      minStockForAvailable: row.minStockForAvailable ?? 1,
    };
  }

  async getSyncPolicyForAdmin(userId: string): Promise<WordPressSyncPolicyView> {
    await this.assertUserExists(userId);
    const status = await this.getStatus(userId);
    return {
      userId,
      syncIntervalHours: status.syncIntervalHours,
      minStockForAvailable: status.minStockForAvailable,
      connected: status.connected,
      lastPingAt: status.lastPingAt,
      lastSyncAt: status.lastSyncAt,
      siteUrl: status.siteUrl,
      pluginVersion: status.pluginVersion,
      catalogReady: status.catalogReady,
    };
  }

  async upsertSyncPolicyForAdmin(
    userId: string,
    input: { syncIntervalHours?: number; minStockForAvailable?: number },
  ): Promise<WordPressSyncPolicyView> {
    await this.assertUserExists(userId);

    const existing = await this.prisma.wordPressConnection.findUnique({
      where: { userId },
    });

    const syncIntervalHours =
      input.syncIntervalHours != null
        ? input.syncIntervalHours
        : (existing?.syncIntervalHours ?? 12);

    if (
      !(WORDPRESS_SYNC_INTERVAL_HOURS as readonly number[]).includes(
        syncIntervalHours,
      )
    ) {
      throw new BadRequestException('بازه همگام‌سازی وردپرس نامعتبر است');
    }

    const minStockForAvailable = normalizeMinStockForAvailable(
      input.minStockForAvailable ?? existing?.minStockForAvailable ?? 1,
    );

    await this.prisma.wordPressConnection.upsert({
      where: { userId },
      create: {
        userId,
        syncIntervalHours,
        minStockForAvailable,
      },
      update: {
        syncIntervalHours,
        minStockForAvailable,
      },
    });

    return this.getSyncPolicyForAdmin(userId);
  }

  private async assertUserExists(userId: string): Promise<void> {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { id: true },
    });
    if (!user) throw new NotFoundException('کاربر یافت نشد');
  }
}
