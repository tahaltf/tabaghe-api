import { Injectable } from '@nestjs/common';
import { existsSync, statSync } from 'fs';
import { join } from 'path';
import {
  WORDPRESS_PLUGIN_ZIP_NAME,
  resolveWordPressPluginUploadDir,
} from '../../../common/upload/wordpress-plugin-upload.config';
import { PrismaService } from '../../../infrastructure/prisma/prisma.service';

export const WORDPRESS_PLUGIN_LATEST_VERSION_KEY =
  'WORDPRESS_PLUGIN_LATEST_VERSION';

export interface WordPressPluginPackageStatus {
  ready: boolean;
  fileName: string;
  sizeBytes: number | null;
  updatedAt: string | null;
  latestVersion: string | null;
}

@Injectable()
export class WordPressPluginPackageService {
  private readonly zipPath = join(
    resolveWordPressPluginUploadDir(),
    WORDPRESS_PLUGIN_ZIP_NAME,
  );

  constructor(private readonly prisma: PrismaService) {}

  getZipPath(): string {
    return this.zipPath;
  }

  isReady(): boolean {
    return existsSync(this.zipPath);
  }

  async ensurePackageReady(): Promise<void> {
    if (!this.isReady()) {
      throw new Error('WordPress plugin ZIP not uploaded');
    }
  }

  private async readLatestVersion(): Promise<string | null> {
    const row = await this.prisma.systemSetting.findUnique({
      where: { key: WORDPRESS_PLUGIN_LATEST_VERSION_KEY },
    });
    const value = row?.value?.trim();
    return value ? value : null;
  }

  async setLatestVersion(version: string | null): Promise<string | null> {
    const normalized = version?.trim() ? version.trim().slice(0, 32) : null;
    if (!normalized) {
      await this.prisma.systemSetting.deleteMany({
        where: { key: WORDPRESS_PLUGIN_LATEST_VERSION_KEY },
      });
      return null;
    }
    await this.prisma.systemSetting.upsert({
      where: { key: WORDPRESS_PLUGIN_LATEST_VERSION_KEY },
      create: {
        key: WORDPRESS_PLUGIN_LATEST_VERSION_KEY,
        value: normalized,
        description: 'آخرین نسخه منتشرشده افزونه وردپرس',
      },
      update: { value: normalized },
    });
    return normalized;
  }

  async getStatus(): Promise<WordPressPluginPackageStatus> {
    const latestVersion = await this.readLatestVersion();
    if (!this.isReady()) {
      return {
        ready: false,
        fileName: WORDPRESS_PLUGIN_ZIP_NAME,
        sizeBytes: null,
        updatedAt: null,
        latestVersion,
      };
    }

    const stat = statSync(this.zipPath);
    return {
      ready: true,
      fileName: WORDPRESS_PLUGIN_ZIP_NAME,
      sizeBytes: stat.size,
      updatedAt: stat.mtime.toISOString(),
      latestVersion,
    };
  }
}
