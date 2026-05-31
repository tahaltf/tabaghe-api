import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { spawnSync } from 'child_process';
import { PrismaService } from '../../../infrastructure/prisma/prisma.service';
import { AdminBackupService } from './admin-backup.service';
import {
  AdminServerStorageService,
  type ServerStorageOverview,
} from './admin-server-storage.service';

export type MonitorHealthStatus = 'ok' | 'warning' | 'critical' | 'unknown';

export interface MonitorHealthCheck {
  id: string;
  label: string;
  status: MonitorHealthStatus;
  message: string;
  detail?: string;
}

export interface MonitorDockerContainer {
  name: string;
  status: string;
  image: string;
  running: boolean;
}

export interface MonitorBackupStatus {
  lastRunAt: string | null;
  lastStatus: string | null;
  lastError: string | null;
  lastFileName: string | null;
  lastFileSizeBytes: number | null;
  nextRunAt: string | null;
  enabled: boolean;
  scheduleMode: string;
  postgresContainer: string;
}

export interface MonitorRuntimeInfo {
  nodeEnv: string;
  nodeUptimeSec: number;
  heapUsedMb: number;
  heapTotalMb: number;
  rssMb: number;
}

export interface ServerMonitorOverview {
  overallStatus: MonitorHealthStatus;
  healthChecks: MonitorHealthCheck[];
  storage: ServerStorageOverview;
  backup: MonitorBackupStatus;
  runtime: MonitorRuntimeInfo;
  dockerContainers: MonitorDockerContainer[];
  issues: string[];
  checkedAt: string;
}

@Injectable()
export class AdminServerMonitorService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly configService: ConfigService,
    private readonly storage: AdminServerStorageService,
    private readonly backup: AdminBackupService,
  ) {}

  async getOverview(): Promise<ServerMonitorOverview> {
    const storage = await this.storage.getOverview();
    const backupCfg = await this.backup.getConfig();
    const healthChecks: MonitorHealthCheck[] = [];
    const issues: string[] = [...storage.warnings];

    healthChecks.push(await this.checkDatabase());
    healthChecks.push(this.checkDisk(storage));
    healthChecks.push(this.checkBackup(backupCfg, issues));
    healthChecks.push(this.checkDocker(storage));

    const dockerContainers = await this.listDockerContainers();

    const postgresName = backupCfg.postgresContainer;
    const pgContainer = dockerContainers.find((c) => c.name === postgresName);
    if (storage.docker.available && !pgContainer?.running) {
      healthChecks.push({
        id: 'postgres_container',
        label: 'کانتینر Postgres',
        status: pgContainer ? 'critical' : 'warning',
        message: pgContainer
          ? `کانتینر ${postgresName} در حال اجرا نیست`
          : `کانتینر ${postgresName} یافت نشد`,
        detail: pgContainer?.status,
      });
      issues.push(`کانتینر Postgres (${postgresName}) مشکل دارد`);
    } else if (storage.docker.available && pgContainer?.running) {
      healthChecks.push({
        id: 'postgres_container',
        label: 'کانتینر Postgres',
        status: 'ok',
        message: `${postgresName} — در حال اجرا`,
        detail: pgContainer.status,
      });
    }

    const backendContainer = dockerContainers.find(
      (c) =>
        c.name.includes('backend') ||
        c.name.includes('api') ||
        c.name === 'tabagheh_api',
    );
    if (storage.docker.available && backendContainer) {
      healthChecks.push({
        id: 'api_container',
        label: 'کانتینر API',
        status: backendContainer.running ? 'ok' : 'critical',
        message: backendContainer.running
          ? `${backendContainer.name} — فعال`
          : `${backendContainer.name} — متوقف`,
        detail: backendContainer.status,
      });
      if (!backendContainer.running) {
        issues.push(`کانتینر API (${backendContainer.name}) متوقف است`);
      }
    }

    const overallStatus = this.worstStatus(healthChecks.map((h) => h.status));

    return {
      overallStatus,
      healthChecks,
      storage,
      backup: {
        lastRunAt: backupCfg.lastRunAt,
        lastStatus: backupCfg.lastStatus,
        lastError: backupCfg.lastError,
        lastFileName: backupCfg.lastFileName,
        lastFileSizeBytes: backupCfg.lastFileSizeBytes,
        nextRunAt: backupCfg.nextRunAt,
        enabled: backupCfg.enabled,
        scheduleMode: backupCfg.scheduleMode,
        postgresContainer: backupCfg.postgresContainer,
      },
      runtime: this.readRuntime(),
      dockerContainers: dockerContainers.slice(0, 20),
      issues: [...new Set(issues)],
      checkedAt: new Date().toISOString(),
    };
  }

  private async checkDatabase(): Promise<MonitorHealthCheck> {
    try {
      const start = Date.now();
      await this.prisma.$queryRaw`SELECT 1`;
      const ms = Date.now() - start;
      return {
        id: 'database',
        label: 'پایگاه داده',
        status: ms > 2000 ? 'warning' : 'ok',
        message: ms > 2000 ? `پاسخ کند (${ms}ms)` : 'اتصال سالم',
        detail: `latency ${ms}ms`,
      };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return {
        id: 'database',
        label: 'پایگاه داده',
        status: 'critical',
        message: 'اتصال برقرار نیست',
        detail: msg,
      };
    }
  }

  private checkDisk(storage: ServerStorageOverview): MonitorHealthCheck {
    const disk = storage.disk;
    if (!disk) {
      return {
        id: 'disk',
        label: 'فضای دیسک',
        status: 'unknown',
        message: 'اطلاعات دیسک در دسترس نیست',
      };
    }
    if (disk.usePercent >= 95) {
      return {
        id: 'disk',
        label: 'فضای دیسک',
        status: 'critical',
        message: `${disk.usePercent}% پر — خطر قطعی سرویس`,
        detail: `${this.formatBytes(disk.availBytes)} آزاد`,
      };
    }
    if (disk.usePercent >= 85) {
      return {
        id: 'disk',
        label: 'فضای دیسک',
        status: 'warning',
        message: `${disk.usePercent}% استفاده شده`,
        detail: `${this.formatBytes(disk.availBytes)} آزاد`,
      };
    }
    return {
      id: 'disk',
      label: 'فضای دیسک',
      status: 'ok',
      message: `${disk.usePercent}% استفاده — ${this.formatBytes(disk.availBytes)} آزاد`,
    };
  }

  private checkBackup(
    cfg: Awaited<ReturnType<AdminBackupService['getConfig']>>,
    issues: string[],
  ): MonitorHealthCheck {
    if (cfg.lastStatus === 'failed' && cfg.lastError) {
      issues.push(`آخرین بک‌اپ ناموفق: ${cfg.lastError}`);
      return {
        id: 'backup',
        label: 'بک‌اپ Postgres',
        status: 'critical',
        message: 'آخرین بک‌اپ ناموفق',
        detail: cfg.lastError,
      };
    }
    if (cfg.lastStatus === 'running') {
      return {
        id: 'backup',
        label: 'بک‌اپ Postgres',
        status: 'warning',
        message: 'بک‌اپ در حال اجرا',
      };
    }
    if (!cfg.lastRunAt) {
      return {
        id: 'backup',
        label: 'بک‌اپ Postgres',
        status: 'warning',
        message: 'هنوز بک‌اپی ثبت نشده',
      };
    }
    const ageMs = Date.now() - new Date(cfg.lastRunAt).getTime();
    const ageDays = ageMs / (24 * 60 * 60 * 1000);
    if (ageDays > 7) {
      issues.push('آخرین بک‌اپ بیش از ۷ روز پیش بوده');
      return {
        id: 'backup',
        label: 'بک‌اپ Postgres',
        status: 'warning',
        message: 'بک‌اپ قدیمی (بیش از ۷ روز)',
        detail: cfg.lastFileName ?? undefined,
      };
    }
    return {
      id: 'backup',
      label: 'بک‌اپ Postgres',
      status: 'ok',
      message: cfg.lastFileName ? `آخرین: ${cfg.lastFileName}` : 'آخرین بک‌اپ موفق',
      detail: cfg.lastRunAt,
    };
  }

  private checkDocker(storage: ServerStorageOverview): MonitorHealthCheck {
    if (!storage.docker.available) {
      return {
        id: 'docker',
        label: 'Docker',
        status: 'unknown',
        message: 'Docker از داخل API در دسترس نیست',
        detail: storage.docker.reason,
      };
    }
    if (storage.docker.imagesReclaimableBytes > 2 * 1024 * 1024 * 1024) {
      return {
        id: 'docker',
        label: 'Docker',
        status: 'warning',
        message: `${this.formatBytes(storage.docker.imagesReclaimableBytes)} image قابل پاکسازی`,
        detail: `${storage.docker.imagesTotal} image`,
      };
    }
    return {
      id: 'docker',
      label: 'Docker',
      status: 'ok',
      message: `${storage.docker.containersActive}/${storage.docker.containersTotal} کانتینر فعال`,
      detail: `${storage.docker.imagesTotal} image`,
    };
  }

  private readRuntime(): MonitorRuntimeInfo {
    const mem = process.memoryUsage();
    return {
      nodeEnv: this.configService.get<string>('NODE_ENV') ?? 'unknown',
      nodeUptimeSec: Math.round(process.uptime()),
      heapUsedMb: Math.round(mem.heapUsed / 1024 / 1024),
      heapTotalMb: Math.round(mem.heapTotal / 1024 / 1024),
      rssMb: Math.round(mem.rss / 1024 / 1024),
    };
  }

  private async listDockerContainers(): Promise<MonitorDockerContainer[]> {
    try {
      const r = spawnSync(
        'docker',
        ['ps', '-a', '--format', '{{.Names}}|{{.Status}}|{{.Image}}'],
        { encoding: 'utf8', timeout: 8000 },
      );
      if (r.status !== 0) return [];
      return r.stdout
        .trim()
        .split('\n')
        .filter(Boolean)
        .map((line) => {
          const [name, status, image] = line.split('|');
          const running = (status ?? '').toLowerCase().startsWith('up');
          return {
            name: name ?? '',
            status: status ?? '',
            image: image ?? '',
            running,
          };
        });
    } catch {
      return [];
    }
  }

  private worstStatus(statuses: MonitorHealthStatus[]): MonitorHealthStatus {
    if (statuses.includes('critical')) return 'critical';
    if (statuses.includes('warning')) return 'warning';
    if (statuses.every((s) => s === 'unknown')) return 'unknown';
    return 'ok';
  }

  private formatBytes(n: number): string {
    if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
    if (n < 1024 * 1024 * 1024) return `${(n / (1024 * 1024)).toFixed(1)} MB`;
    return `${(n / (1024 * 1024 * 1024)).toFixed(2)} GB`;
  }
}
