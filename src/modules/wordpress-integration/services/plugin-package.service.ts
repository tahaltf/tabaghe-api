import { Injectable } from '@nestjs/common';
import { existsSync, statSync } from 'fs';
import { join } from 'path';
import {
  WORDPRESS_PLUGIN_ZIP_NAME,
  resolveWordPressPluginUploadDir,
} from '../../../common/upload/wordpress-plugin-upload.config';

export interface WordPressPluginPackageStatus {
  ready: boolean;
  fileName: string;
  sizeBytes: number | null;
  updatedAt: string | null;
}

@Injectable()
export class WordPressPluginPackageService {
  private readonly zipPath = join(
    resolveWordPressPluginUploadDir(),
    WORDPRESS_PLUGIN_ZIP_NAME,
  );

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

  getStatus(): WordPressPluginPackageStatus {
    if (!this.isReady()) {
      return {
        ready: false,
        fileName: WORDPRESS_PLUGIN_ZIP_NAME,
        sizeBytes: null,
        updatedAt: null,
      };
    }

    const stat = statSync(this.zipPath);
    return {
      ready: true,
      fileName: WORDPRESS_PLUGIN_ZIP_NAME,
      sizeBytes: stat.size,
      updatedAt: stat.mtime.toISOString(),
    };
  }
}
