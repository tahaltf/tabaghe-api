import { BadRequestException, Injectable } from '@nestjs/common';
import { existsSync, readFileSync, statSync, unlinkSync } from 'fs';
import { join } from 'path';
import { inflateRawSync } from 'zlib';
import {
  WORDPRESS_PLUGIN_ZIP_NAME,
  resolveWordPressPluginUploadDir,
} from '../../../common/upload/wordpress-plugin-upload.config';
import { PrismaService } from '../../../infrastructure/prisma/prisma.service';

export const WORDPRESS_PLUGIN_LATEST_VERSION_KEY =
  'WORDPRESS_PLUGIN_LATEST_VERSION';

const PLUGIN_ROOT = 'tabagheh-sync/';
const PLUGIN_MAIN = 'tabagheh-sync/tabagheh-sync.php';

export interface WordPressPluginPackageStatus {
  ready: boolean;
  fileName: string;
  sizeBytes: number | null;
  updatedAt: string | null;
  latestVersion: string | null;
}

export interface WordPressPluginUpdateManifest extends WordPressPluginPackageStatus {
  slug: string;
  plugin: string;
  name: string;
  homepage: string;
  downloadUrl: string | null;
  requires: string;
  requiresPhp: string;
  tested: string;
  sections: {
    description: string;
    changelog: string;
  };
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

  /**
   * Validate uploaded zip layout and sync latestVersion from plugin header.
   * Expected:
   *   tabagheh-sync/tabagheh-sync.php
   */
  async validateUploadedZipAndSyncVersion(): Promise<WordPressPluginPackageStatus> {
    if (!this.isReady()) {
      throw new BadRequestException('فایل ZIP افزونه ارسال نشد');
    }

    let names: string[];
    try {
      names = listZipEntryNames(this.zipPath);
    } catch {
      this.removeInvalidZip();
      throw new BadRequestException('فایل ZIP نامعتبر است');
    }

    const normalized = names
      .map((n) => n.replace(/\\/g, '/'))
      .filter((n) => n && !n.endsWith('/'));

    if (normalized.length === 0) {
      this.removeInvalidZip();
      throw new BadRequestException('فایل ZIP خالی است');
    }

    const hasMain = normalized.includes(PLUGIN_MAIN);
    if (!hasMain) {
      this.removeInvalidZip();
      throw new BadRequestException(
        'ساختار ZIP اشتباه است. باید tabagheh-sync/tabagheh-sync.php در ریشه باشد.',
      );
    }

    const outsideRoot = normalized.some(
      (n) => !n.startsWith(PLUGIN_ROOT) && n !== PLUGIN_MAIN,
    );
    if (outsideRoot) {
      this.removeInvalidZip();
      throw new BadRequestException(
        'همه فایل‌های ZIP باید داخل پوشه tabagheh-sync/ باشند.',
      );
    }

    // Reject accidental double-nest: tabagheh-sync/tabagheh-sync/...
    if (normalized.some((n) => n.startsWith('tabagheh-sync/tabagheh-sync/'))) {
      this.removeInvalidZip();
      throw new BadRequestException(
        'ZIP تو‌در‌تو است. پوشه را یک‌بار به‌صورت tabagheh-sync/ فشرده کنید.',
      );
    }

    let versionFromHeader: string | null = null;
    try {
      const php = readZipTextEntry(this.zipPath, PLUGIN_MAIN);
      versionFromHeader = parsePluginHeaderVersion(php);
    } catch {
      this.removeInvalidZip();
      throw new BadRequestException(
        'نتوانستیم فایل اصلی افزونه را از ZIP بخوانیم.',
      );
    }

    if (!versionFromHeader) {
      this.removeInvalidZip();
      throw new BadRequestException(
        'هدر Version در tabagheh-sync.php یافت نشد.',
      );
    }

    await this.setLatestVersion(versionFromHeader);
    return this.getStatus();
  }

  private removeInvalidZip(): void {
    try {
      if (existsSync(this.zipPath)) {
        unlinkSync(this.zipPath);
      }
    } catch {
      // ignore cleanup failures
    }
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

  async getUpdateManifest(
    apiV1Base: string,
  ): Promise<WordPressPluginUpdateManifest> {
    const status = await this.getStatus();
    const base = apiV1Base.replace(/\/$/, '');
    return {
      ...status,
      slug: 'tabagheh-sync',
      plugin: 'tabagheh-sync/tabagheh-sync.php',
      name: 'Tabagheh Sync',
      homepage: 'https://tabagheh.com',
      downloadUrl: status.ready
        ? `${base}/integrations/wordpress/plugin/download`
        : null,
      requires: '6.0',
      requiresPhp: '8.0',
      tested: '6.7',
      sections: {
        description:
          'ارسال محصولات ووکامرس به بازار طبقه برای بررسی و انتشار.',
        changelog: status.latestVersion
          ? `نسخه ${status.latestVersion}`
          : 'آخرین نسخه منتشرشده افزونه همگام‌سازی طبقه.',
      },
    };
  }
}

function parsePluginHeaderVersion(phpSource: string): string | null {
  const match = /^[\t ]*\*?[\t ]*Version:\s*([0-9][0-9A-Za-z._-]*)/im.exec(
    phpSource,
  );
  return match?.[1]?.trim() || null;
}

function listZipEntryNames(filePath: string): string[] {
  const data = readFileSync(filePath);
  let eocd = -1;
  const min = Math.max(0, data.length - 0xffff - 22);
  for (let i = data.length - 22; i >= min; i -= 1) {
    if (data.readUInt32LE(i) === 0x06054b50) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) {
    throw new Error('EOCD not found');
  }

  const cdEntries = data.readUInt16LE(eocd + 10);
  let offset = data.readUInt32LE(eocd + 16);
  const names: string[] = [];

  for (let i = 0; i < cdEntries; i += 1) {
    if (offset + 46 > data.length || data.readUInt32LE(offset) !== 0x02014b50) {
      break;
    }
    const nameLen = data.readUInt16LE(offset + 28);
    const extraLen = data.readUInt16LE(offset + 30);
    const commentLen = data.readUInt16LE(offset + 32);
    const nameStart = offset + 46;
    const nameEnd = nameStart + nameLen;
    if (nameEnd > data.length) {
      break;
    }
    names.push(data.subarray(nameStart, nameEnd).toString('utf8'));
    offset = nameEnd + extraLen + commentLen;
  }

  return names;
}

function readZipTextEntry(filePath: string, entryName: string): string {
  const data = readFileSync(filePath);
  const target = entryName.replace(/\\/g, '/');
  let offset = 0;

  while (offset + 30 <= data.length) {
    if (data.readUInt32LE(offset) !== 0x04034b50) {
      break;
    }
    const method = data.readUInt16LE(offset + 8);
    const compSize = data.readUInt32LE(offset + 18);
    const nameLen = data.readUInt16LE(offset + 26);
    const extraLen = data.readUInt16LE(offset + 28);
    const nameStart = offset + 30;
    const nameEnd = nameStart + nameLen;
    if (nameEnd > data.length) {
      break;
    }
    const name = data.subarray(nameStart, nameEnd).toString('utf8').replace(/\\/g, '/');
    const dataStart = nameEnd + extraLen;
    const dataEnd = dataStart + compSize;
    if (dataEnd > data.length) {
      break;
    }

    if (name === target) {
      const compressed = data.subarray(dataStart, dataEnd);
      if (method === 0) {
        return compressed.toString('utf8');
      }
      if (method === 8) {
        return inflateRawSync(compressed).toString('utf8');
      }
      throw new Error(`Unsupported compression method: ${method}`);
    }

    offset = dataEnd;
  }

  throw new Error(`Entry not found: ${entryName}`);
}
