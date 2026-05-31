import {
  BadRequestException,
  Injectable,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { access } from 'fs/promises';
import { spawn } from 'child_process';
import { AdminBackupService } from './admin-backup.service';

export interface DiskUsageInfo {
  filesystem: string;
  mountPoint: string;
  sizeBytes: number;
  usedBytes: number;
  availBytes: number;
  usePercent: number;
}

export interface PathUsageInfo {
  id: 'backups' | 'uploads' | 'uploads_listings' | 'uploads_orders';
  label: string;
  path: string;
  sizeBytes: number | null;
  accessible: boolean;
  note?: string;
}

export interface DockerImageInfo {
  id: string;
  repository: string;
  tag: string;
  sizeBytes: number;
  sizeLabel: string;
  createdSince: string;
}

export interface DockerStorageInfo {
  available: boolean;
  reason?: string;
  imagesTotal: number;
  imagesActive: number;
  imagesSizeBytes: number;
  imagesReclaimableBytes: number;
  containersTotal: number;
  containersActive: number;
  volumesSizeBytes: number;
  buildCacheReclaimableBytes: number;
  images: DockerImageInfo[];
}

export interface BackupStorageSummary {
  fileCount: number;
  totalBytes: number;
  latestFileName: string | null;
  latestCreatedAt: string | null;
  latestSizeBytes: number | null;
  oldestCreatedAt: string | null;
}

export interface ServerStorageOverview {
  disk: DiskUsageInfo | null;
  paths: PathUsageInfo[];
  docker: DockerStorageInfo;
  backups: BackupStorageSummary;
  warnings: string[];
  checkedAt: string;
}

export interface DockerPruneResult {
  reclaimedBytes: number;
  reclaimedLabel: string;
  output: string;
}

@Injectable()
export class AdminServerStorageService {
  private readonly uploadsRoot: string;

  constructor(
    private readonly configService: ConfigService,
    private readonly backupService: AdminBackupService,
  ) {
    this.uploadsRoot = this.normalizePath(
      this.configService.get<string>('UPLOADS_DIR') ?? './uploads',
    );
  }

  async getOverview(): Promise<ServerStorageOverview> {
    const warnings: string[] = [];
    const cfg = await this.backupService.getConfig();
    const backupFiles = await this.backupService.listFiles().catch(() => []);

    const disk = await this.readDiskUsage('/').catch(() => null);
    if (disk && disk.usePercent >= 90) {
      warnings.push(
        `فضای دیسک ${disk.usePercent}% پر شده — بک‌اپ و Docker ممکن است خطا بدهند`,
      );
    }
    if (disk && disk.usePercent >= 95) {
      warnings.push('دیسک تقریباً پر است؛ فوری فضا آزاد کنید');
    }

    const paths: PathUsageInfo[] = [
      await this.pathUsage(
        'backups',
        'بک‌اپ‌های Postgres',
        cfg.backupDir,
      ),
      await this.pathUsage('uploads', 'آپلودها (کل)', this.uploadsRoot),
      await this.pathUsage(
        'uploads_listings',
        'تصاویر آگهی‌ها',
        `${this.uploadsRoot}/listings`,
      ),
      await this.pathUsage(
        'uploads_orders',
        'ویدیو/رسانه سفارش',
        `${this.uploadsRoot}/orders`,
      ),
    ];

    const docker = await this.readDockerStorage();
    if (!docker.available) {
      warnings.push(
        docker.reason ??
          'Docker در دسترس نیست — برای پاک‌سازی imageها socket را mount کنید',
      );
    } else if (docker.imagesReclaimableBytes > 1024 * 1024 * 1024) {
      warnings.push(
        `حدود ${this.formatBytes(docker.imagesReclaimableBytes)} از imageهای Docker قابل آزادسازی است`,
      );
    }

    const backups = this.summarizeBackups(backupFiles);

    return {
      disk,
      paths,
      docker,
      backups,
      warnings,
      checkedAt: new Date().toISOString(),
    };
  }

  async pruneDockerImages(confirmPhrase: string): Promise<DockerPruneResult> {
    if (confirmPhrase !== 'PRUNE:DOCKER_IMAGES') {
      throw new BadRequestException(
        'برای تأیید عبارت PRUNE:DOCKER_IMAGES را وارد کنید',
      );
    }

    const dockerOk = await this.isDockerAvailable();
    if (!dockerOk) {
      throw new ServiceUnavailableException(
        'Docker در دسترس نیست. /var/run/docker.sock را به کانتینر backend mount کنید',
      );
    }

    const { stdout, stderr, code } = await this.runCommand('docker', [
      'image',
      'prune',
      '-a',
      '-f',
    ]);

    if (code !== 0) {
      throw new ServiceUnavailableException(
        stderr.trim() || stdout.trim() || `docker prune exit ${code}`,
      );
    }

    const output = (stdout + stderr).trim();
    const reclaimedLabel =
      output.match(/Total reclaimed space:\s*(.+)/i)?.[1]?.trim() ?? '0B';
    const reclaimedBytes = this.parseDockerSize(reclaimedLabel);

    return { reclaimedBytes, reclaimedLabel, output };
  }

  private summarizeBackups(
    files: Awaited<ReturnType<AdminBackupService['listFiles']>>,
  ): BackupStorageSummary {
    if (!files.length) {
      return {
        fileCount: 0,
        totalBytes: 0,
        latestFileName: null,
        latestCreatedAt: null,
        latestSizeBytes: null,
        oldestCreatedAt: null,
      };
    }

    const totalBytes = files.reduce((s, f) => s + f.sizeBytes, 0);
    const latest = files[0];
    const oldest = files[files.length - 1];

    return {
      fileCount: files.length,
      totalBytes,
      latestFileName: latest.fileName,
      latestCreatedAt: latest.createdAt,
      latestSizeBytes: latest.sizeBytes,
      oldestCreatedAt: oldest.createdAt,
    };
  }

  private async pathUsage(
    id: PathUsageInfo['id'],
    label: string,
    path: string,
  ): Promise<PathUsageInfo> {
    const normalized = this.normalizePath(path);
    try {
      await access(normalized);
      const sizeBytes = await this.readDirSize(normalized);
      return { id, label, path: normalized, sizeBytes, accessible: true };
    } catch {
      return {
        id,
        label,
        path: normalized,
        sizeBytes: null,
        accessible: false,
        note: 'مسیر در دسترس نیست یا خالی است',
      };
    }
  }

  private async readDiskUsage(mountPoint: string): Promise<DiskUsageInfo | null> {
    const { stdout, code } = await this.runCommand('df', [
      '-B1',
      '--output=source,size,used,avail,pcent,target',
      mountPoint,
    ]);

    if (code !== 0) return null;

    const lines = stdout
      .trim()
      .split('\n')
      .map((l) => l.trim())
      .filter(Boolean);

    if (lines.length < 2) return null;

    const dataLine = lines[lines.length - 1];
    const parts = dataLine.split(/\s+/);
    if (parts.length < 6) return null;

    const sizeBytes = Number(parts[1]);
    const usedBytes = Number(parts[2]);
    const availBytes = Number(parts[3]);
    const usePercent = Number(String(parts[4]).replace('%', ''));

    if (!Number.isFinite(sizeBytes)) return null;

    return {
      filesystem: parts[0],
      sizeBytes,
      usedBytes,
      availBytes,
      usePercent,
      mountPoint: parts.slice(5).join(' ') || mountPoint,
    };
  }

  private async readDirSize(path: string): Promise<number> {
    const { stdout, code } = await this.runCommand('du', ['-sb', path]);
    if (code !== 0) return 0;
    const first = stdout.trim().split(/\s+/)[0];
    const n = Number(first);
    return Number.isFinite(n) ? n : 0;
  }

  private async readDockerStorage(): Promise<DockerStorageInfo> {
    const empty: DockerStorageInfo = {
      available: false,
      imagesTotal: 0,
      imagesActive: 0,
      imagesSizeBytes: 0,
      imagesReclaimableBytes: 0,
      containersTotal: 0,
      containersActive: 0,
      volumesSizeBytes: 0,
      buildCacheReclaimableBytes: 0,
      images: [],
    };

    const available = await this.isDockerAvailable();
    if (!available) {
      return {
        ...empty,
        reason:
          'Docker CLI یا socket در دسترس نیست. برای مدیریت imageها: - /var/run/docker.sock:/var/run/docker.sock',
      };
    }

    const dfResult = await this.runCommand('docker', ['system', 'df', '--format', '{{json .}}']);
    let imagesTotal = 0;
    let imagesActive = 0;
    let imagesSizeBytes = 0;
    let imagesReclaimableBytes = 0;
    let containersTotal = 0;
    let containersActive = 0;
    let volumesSizeBytes = 0;
    let buildCacheReclaimableBytes = 0;

    for (const line of dfResult.stdout.trim().split('\n').filter(Boolean)) {
      try {
        const row = JSON.parse(line) as {
          Type?: string;
          TotalCount?: string;
          Active?: string;
          Size?: string;
          Reclaimable?: string;
        };
        const type = String(row.Type ?? '').toLowerCase();
        const total = Number(row.TotalCount ?? 0);
        const active = Number(row.Active ?? 0);
        const size = this.parseDockerSize(String(row.Size ?? '0'));
        const reclaimable = this.parseDockerSize(
          String(row.Reclaimable ?? '0').split('(')[0].trim(),
        );

        if (type === 'images') {
          imagesTotal = total;
          imagesActive = active;
          imagesSizeBytes = size;
          imagesReclaimableBytes = reclaimable;
        } else if (type === 'containers') {
          containersTotal = total;
          containersActive = active;
        } else if (type === 'local volumes') {
          volumesSizeBytes = size;
        } else if (type === 'build cache') {
          buildCacheReclaimableBytes = reclaimable;
        }
      } catch {
        // ignore malformed lines
      }
    }

    const imagesResult = await this.runCommand('docker', [
      'images',
      '--format',
      '{{.ID}}|{{.Repository}}|{{.Tag}}|{{.Size}}|{{.CreatedSince}}',
    ]);

    const images: DockerImageInfo[] = imagesResult.stdout
      .trim()
      .split('\n')
      .filter(Boolean)
      .slice(0, 40)
      .map((line) => {
        const [id, repository, tag, sizeLabel, createdSince] = line.split('|');
        return {
          id: id ?? '',
          repository: repository ?? '<none>',
          tag: tag ?? '',
          sizeBytes: this.parseDockerSize(sizeLabel ?? '0'),
          sizeLabel: sizeLabel ?? '0',
          createdSince: createdSince ?? '',
        };
      });

    return {
      available: true,
      imagesTotal,
      imagesActive,
      imagesSizeBytes,
      imagesReclaimableBytes,
      containersTotal,
      containersActive,
      volumesSizeBytes,
      buildCacheReclaimableBytes,
      images,
    };
  }

  private async isDockerAvailable(): Promise<boolean> {
    try {
      await access('/var/run/docker.sock');
    } catch {
      // socket optional — docker CLI might still work on host
    }

    const { code } = await this.runCommand('docker', ['info', '--format', '{{.ServerVersion}}']);
    return code === 0;
  }

  private parseDockerSize(raw: string): number {
    const s = raw.trim().toUpperCase();
    const m = s.match(/^([\d.]+)\s*(B|KB|MB|GB|TB|KIB|MIB|GIB|TIB)?$/i);
    if (!m) return 0;
    const n = parseFloat(m[1]);
    const unit = (m[2] ?? 'B').toUpperCase();
    const mult: Record<string, number> = {
      B: 1,
      KB: 1000,
      KIB: 1024,
      MB: 1000 ** 2,
      MIB: 1024 ** 2,
      GB: 1000 ** 3,
      GIB: 1024 ** 3,
      TB: 1000 ** 4,
      TIB: 1024 ** 4,
    };
    return Math.round(n * (mult[unit] ?? 1));
  }

  private formatBytes(n: number): string {
    if (n < 1024) return `${n} B`;
    if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
    if (n < 1024 * 1024 * 1024) return `${(n / (1024 * 1024)).toFixed(1)} MB`;
    return `${(n / (1024 * 1024 * 1024)).toFixed(2)} GB`;
  }

  private normalizePath(p: string): string {
    return p.replace(/\\/g, '/').replace(/\/+$/, '') || p;
  }

  private runCommand(
    cmd: string,
    args: string[],
    timeoutMs = 120_000,
  ): Promise<{ stdout: string; stderr: string; code: number }> {
    return new Promise((resolve) => {
      const child = spawn(cmd, args, { env: process.env });
      let stdout = '';
      let stderr = '';
      let settled = false;

      const timer = setTimeout(() => {
        if (settled) return;
        settled = true;
        child.kill('SIGTERM');
        resolve({ stdout, stderr: `${stderr}\nTimeout`, code: 124 });
      }, timeoutMs);

      child.stdout.on('data', (d) => (stdout += String(d)));
      child.stderr.on('data', (d) => (stderr += String(d)));
      child.on('error', (err) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        resolve({ stdout, stderr: err.message, code: 127 });
      });
      child.on('close', (code) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        resolve({ stdout, stderr, code: code ?? 1 });
      });
    });
  }
}
