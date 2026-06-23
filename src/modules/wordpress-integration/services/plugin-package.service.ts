import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { createWriteStream, existsSync, mkdirSync } from 'fs';
import { join } from 'path';
import archiver from 'archiver';

const PLUGIN_FOLDER_NAME = 'tabaghe-sync';
const PLUGIN_MAIN_FILE = 'tabaghe-sync.php';
const ZIP_FILE_NAME = 'tabaghe-sync.zip';

@Injectable()
export class WordPressPluginPackageService implements OnModuleInit {
  private readonly logger = new Logger(WordPressPluginPackageService.name);
  private readonly zipPath = join(
    process.cwd(),
    'uploads',
    'downloads',
    ZIP_FILE_NAME,
  );
  private buildPromise: Promise<void> | null = null;

  async onModuleInit(): Promise<void> {
    try {
      await this.ensurePackageReady();
    } catch (err) {
      this.logger.warn(
        `WordPress plugin ZIP not ready at startup: ${String((err as Error)?.message ?? err)}`,
      );
    }
  }

  getZipPath(): string {
    return this.zipPath;
  }

  async ensurePackageReady(): Promise<void> {
    if (existsSync(this.zipPath)) {
      return;
    }

    if (!this.buildPromise) {
      this.buildPromise = this.buildZip().finally(() => {
        this.buildPromise = null;
      });
    }

    await this.buildPromise;
  }

  private resolvePluginSourceDir(): string | null {
    const candidates = [
      join(process.cwd(), 'assets', 'tabaghe-wordpress-plugin'),
      join(process.cwd(), '..', 'tabaghe-wordpress-plugin'),
      join(process.cwd(), 'tabaghe-wordpress-plugin'),
    ];

    for (const dir of candidates) {
      if (existsSync(join(dir, PLUGIN_MAIN_FILE))) {
        return dir;
      }
    }

    return null;
  }

  private async buildZip(): Promise<void> {
    const sourceDir = this.resolvePluginSourceDir();
    if (!sourceDir) {
      throw new Error('WordPress plugin source directory not found');
    }

    mkdirSync(join(process.cwd(), 'uploads', 'downloads'), { recursive: true });
    await this.createZipFromDirectory(sourceDir, this.zipPath, PLUGIN_FOLDER_NAME);
    this.logger.log(`Built WordPress plugin package at ${this.zipPath}`);
  }

  private createZipFromDirectory(
    sourceDir: string,
    zipPath: string,
    folderName: string,
  ): Promise<void> {
    return new Promise((resolve, reject) => {
      const output = createWriteStream(zipPath);
      const archive = archiver('zip', { zlib: { level: 9 } });

      output.on('close', () => resolve());
      archive.on('error', reject);
      output.on('error', reject);

      archive.pipe(output);
      archive.directory(sourceDir, folderName);
      void archive.finalize();
    });
  }
}
