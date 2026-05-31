import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createReadStream, createWriteStream } from 'fs';
import { access, mkdir, readdir, stat, unlink } from 'fs/promises';
import { join, resolve } from 'path';
import { spawn, spawnSync } from 'child_process';
import { PrismaService } from '../../../infrastructure/prisma/prisma.service';
import type { UpdateBackupConfigDto } from '../dto/admin-backup.dto';

export const BACKUP_CONFIG_KEY = 'GODADMIN_BACKUP_CONFIG';

export type BackupScheduleMode = 'manual' | 'interval';
export type BackupRunSource = 'manual' | 'scheduled';

export interface BackupConfig {
  enabled: boolean;
  scheduleMode: BackupScheduleMode;
  intervalHours: number;
  retentionDays: number;
  backupDir: string;
  preferHostScript: boolean;
  lastRunAt: string | null;
  lastStatus: 'success' | 'failed' | 'running' | null;
  lastError: string | null;
  lastFileName: string | null;
  lastFileSizeBytes: number | null;
  nextRunAt: string | null;
}

export interface BackupFileItem {
  fileName: string;
  sizeBytes: number;
  createdAt: string;
}

export interface BackupFilesSummary {
  fileCount: number;
  totalBytes: number;
  latestFileName: string | null;
  latestCreatedAt: string | null;
  latestSizeBytes: number | null;
}

export interface BackupConfigResponse extends BackupConfig {
  hostScriptPath: string | null;
  filesSummary: BackupFilesSummary;
  /** آخرین فایل واقعی روی دیسک (ممکن است با lastRunAt متفاوت باشد) */
  latestOnDisk: BackupFileItem | null;
  postgresContainer: string;
}

export interface ServerJobInfo {
  id: string;
  name: string;
  schedule: string;
  description: string;
  managedBy: 'app' | 'host';
  command?: string;
}

export interface BackupGuideCommand {
  label: string;
  command: string;
}

export interface BackupGuideSection {
  id: string;
  title: string;
  paragraphs: string[];
  bullets?: string[];
  commands?: BackupGuideCommand[];
}

export interface BackupGuide {
  sections: BackupGuideSection[];
}

const DEFAULT_CONFIG: BackupConfig = {
  enabled: false,
  scheduleMode: 'manual',
  intervalHours: 24,
  retentionDays: 14,
  backupDir: '/var/backups/tabagheh/postgres',
  preferHostScript: true,
  lastRunAt: null,
  lastStatus: null,
  lastError: null,
  lastFileName: null,
  lastFileSizeBytes: null,
  nextRunAt: null,
};

@Injectable()
export class AdminBackupService {
  private readonly logger = new Logger(AdminBackupService.name);
  private runLock = false;

  constructor(
    private readonly prisma: PrismaService,
    private readonly configService: ConfigService,
  ) {}

  async getConfig(): Promise<BackupConfigResponse> {
    const cfg = await this.loadConfig();
    const files = await this.listFiles().catch(() => [] as BackupFileItem[]);
    const synced = await this.syncConfigFromDiskFiles(cfg, files);
    const latestOnDisk = files[0] ?? null;

    return {
      ...synced,
      hostScriptPath: this.hostScriptPath(),
      filesSummary: this.buildFilesSummary(files),
      latestOnDisk,
      postgresContainer: this.resolvePostgresContainer(),
    };
  }

  async pruneBackupFiles(
    mode: 'retention' | 'keepLatest' | 'allExceptLatest' | 'all',
    keepLatest = 1,
  ): Promise<{ deleted: string[]; kept: string[] }> {
    const cfg = await this.loadConfig();
    const files = await this.listFiles();

    if (!files.length) {
      return { deleted: [], kept: [] };
    }

    let toDelete: BackupFileItem[] = [];

    switch (mode) {
      case 'retention': {
        const cutoff =
          Date.now() - cfg.retentionDays * 24 * 60 * 60 * 1000;
        toDelete = files.filter(
          (f) => new Date(f.createdAt).getTime() < cutoff,
        );
        break;
      }
      case 'keepLatest': {
        const n = Math.max(1, keepLatest);
        toDelete = files.slice(n);
        break;
      }
      case 'allExceptLatest':
        toDelete = files.slice(1);
        break;
      case 'all':
        toDelete = [...files];
        break;
      default:
        throw new BadRequestException('حالت پاکسازی نامعتبر است');
    }

    const deleted: string[] = [];
    for (const f of toDelete) {
      await unlink(join(cfg.backupDir, f.fileName)).catch(() => undefined);
      deleted.push(f.fileName);
    }

    const kept = files
      .map((f) => f.fileName)
      .filter((name) => !deleted.includes(name));

    if (deleted.length) {
      const remaining = await this.listFiles().catch(() => []);
      const latest = remaining[0] ?? null;
      await this.saveConfig({
        ...cfg,
        lastFileName: latest?.fileName ?? null,
        lastFileSizeBytes: latest?.sizeBytes ?? null,
        lastRunAt: latest?.createdAt ?? cfg.lastRunAt,
        lastStatus: latest ? 'success' : cfg.lastStatus,
      });
    }

    return { deleted, kept };
  }

  async updateConfig(
    dto: UpdateBackupConfigDto,
    actorUserId: string,
  ): Promise<BackupConfig> {
    if (
      dto.scheduleMode === 'interval' &&
      !([1, 3, 6, 12, 24, 168] as number[]).includes(dto.intervalHours)
    ) {
      throw new BadRequestException(
        'فاصله زمانی باید یکی از ۱، ۳، ۶، ۱۲، ۲۴ یا ۱۶۸ ساعت باشد',
      );
    }

    const prev = await this.loadConfig();
    const backupDir = this.normalizeBackupDir(
      dto.backupDir?.trim() || prev.backupDir,
    );

    const next: BackupConfig = {
      ...prev,
      enabled: dto.enabled,
      scheduleMode: dto.scheduleMode,
      intervalHours: dto.intervalHours,
      retentionDays: dto.retentionDays,
      backupDir,
      preferHostScript: dto.preferHostScript ?? prev.preferHostScript,
      nextRunAt: this.computeNextRunAt(
        dto.enabled && dto.scheduleMode === 'interval',
        dto.intervalHours,
        prev.lastRunAt,
      ),
    };

    await this.saveConfig(next);
    this.logger.log(`Backup config updated by GODADMIN ${actorUserId}`);
    return next;
  }

  async listFiles(): Promise<BackupFileItem[]> {
    const cfg = await this.loadConfig();
    const dir = cfg.backupDir;
    await this.ensureBackupDir(dir);

    const names = await readdir(dir);
    const items: BackupFileItem[] = [];
    for (const fileName of names) {
      if (!this.isValidBackupFileName(fileName)) continue;
      const full = join(dir, fileName);
      const st = await stat(full);
      if (!st.isFile()) continue;
      items.push({
        fileName,
        sizeBytes: st.size,
        createdAt: st.mtime.toISOString(),
      });
    }
    return items.sort(
      (a, b) =>
        new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
    );
  }

  async runBackup(source: BackupRunSource): Promise<{
    fileName: string;
    sizeBytes: number;
    path: string;
  }> {
    if (this.runLock) {
      throw new ConflictException(
        'یک بک‌اپ در حال اجراست؛ لطفاً چند دقیقه صبر کنید',
      );
    }

    this.runLock = true;
    const cfg = await this.loadConfig();
    const running: BackupConfig = {
      ...cfg,
      lastStatus: 'running',
      lastError: null,
    };
    await this.saveConfig(running);

    try {
      const result = await this.executeBackup(cfg);
      const st = await stat(result.path);
      const updated: BackupConfig = {
        ...cfg,
        lastRunAt: new Date().toISOString(),
        lastStatus: 'success',
        lastError: null,
        lastFileName: result.fileName,
        lastFileSizeBytes: st.size,
        nextRunAt:
          cfg.enabled && cfg.scheduleMode === 'interval'
            ? this.computeNextRunAt(
                true,
                cfg.intervalHours,
                new Date().toISOString(),
              )
            : null,
      };
      await this.saveConfig(updated);
      this.logger.log(
        `Backup ${source} OK: ${result.fileName} (${st.size} bytes)`,
      );
      return {
        fileName: result.fileName,
        sizeBytes: st.size,
        path: result.path,
      };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      await this.saveConfig({
        ...cfg,
        lastRunAt: new Date().toISOString(),
        lastStatus: 'failed',
        lastError: message,
      });
      this.logger.error(`Backup ${source} failed: ${message}`);
      throw new ServiceUnavailableException(`بک‌اپ ناموفق: ${message}`);
    } finally {
      this.runLock = false;
    }
  }

  async shouldRunScheduled(): Promise<boolean> {
    const cfg = await this.loadConfig();
    if (!cfg.enabled || cfg.scheduleMode !== 'interval' || this.runLock) {
      return false;
    }
    if (!cfg.nextRunAt) return true;
    return Date.now() >= new Date(cfg.nextRunAt).getTime();
  }

  async deleteFile(fileName: string): Promise<{ fileName: string }> {
    const path = await this.resolveBackupPath(fileName);
    await unlink(path);
    return { fileName };
  }

  async registerUploadedFile(
    fileName: string,
    sizeBytes: number,
  ): Promise<BackupFileItem> {
    if (!this.isValidBackupFileName(fileName) && !/^tabagheh_db_.+\.dump$/.test(fileName)) {
      throw new BadRequestException('نام فایل بک‌اپ نامعتبر است');
    }

    const cfg = await this.loadConfig();
    const item: BackupFileItem = {
      fileName,
      sizeBytes,
      createdAt: new Date().toISOString(),
    };

    await this.saveConfig({
      ...cfg,
      lastRunAt: item.createdAt,
      lastStatus: 'success',
      lastError: null,
      lastFileName: fileName,
      lastFileSizeBytes: sizeBytes,
    });

    return item;
  }

  async getDownloadPayload(fileName: string): Promise<{
    stream: ReturnType<typeof createReadStream>;
    size: number;
    fileName: string;
  }> {
    const decoded = decodeURIComponent(fileName);
    const path = await this.resolveBackupPath(decoded);
    const info = await stat(path);
    return {
      stream: createReadStream(path),
      size: info.size,
      fileName: decoded,
    };
  }

  getServerJobs(cfg: BackupConfig): {
    inAppSchedulers: ServerJobInfo[];
    recommendedHostCrons: ServerJobInfo[];
    suggestedCrontabLines: string[];
    guide: BackupGuide;
  } {
    const inAppSchedulers: ServerJobInfo[] = [
      {
        id: 'backup_interval',
        name: 'بک‌اپ Postgres (طبقه)',
        schedule:
          cfg.scheduleMode === 'interval' && cfg.enabled
            ? `هر ${cfg.intervalHours} ساعت (داخل API)`
            : 'غیرفعال',
        description:
          'زمان‌بندی از پنل GODADMIN؛ نیاز به اجرای دائم سرویس backend',
        managedBy: 'app',
      },
      {
        id: 'auction_finalize',
        name: 'نهایی‌سازی مزایده',
        schedule: 'هر ۱ دقیقه',
        description: 'AuctionJob / AuctionScheduler',
        managedBy: 'app',
      },
      {
        id: 'auction_reconcile',
        name: 'تسویه / همگام‌سازی مزایده',
        schedule: '۰۲:۱۰ و ۰۳:۲۰ روزانه',
        description: 'AuctionScheduler',
        managedBy: 'app',
      },
      {
        id: 'orders_hourly',
        name: 'سفارش‌ها (انقضا / یادآوری)',
        schedule: 'هر ساعت',
        description: 'OrdersService cron handlers',
        managedBy: 'app',
      },
      {
        id: 'repair_hourly',
        name: 'درخواست تعمیر',
        schedule: 'هر ساعت',
        description: 'RepairService cron',
        managedBy: 'app',
      },
    ];

    const hostCron = this.intervalToCron(cfg.intervalHours);
    const script =
      this.hostScriptPath() ?? '/usr/local/bin/tabagheh_pg_backup.sh';
    const recommendedHostCrons: ServerJobInfo[] = [
      {
        id: 'host_pg_backup',
        name: 'بک‌اپ Postgres (cron هاست)',
        schedule: hostCron,
        description: `نگهداری ${cfg.retentionDays} روز — مسیر: ${cfg.backupDir}`,
        managedBy: 'host',
        command: script,
      },
    ];

    const suggestedCrontabLines = [
      `# Tabagheh — بک‌اپ Postgres (توصیه می‌شود اگر API داخل Docker است)`,
      `RETENTION_DAYS=${cfg.retentionDays} BACKUP_DIR=${cfg.backupDir} ${hostCron} ${script} >>/var/log/tabagheh_pg_backup.log 2>&1`,
    ];

    return {
      inAppSchedulers,
      recommendedHostCrons,
      suggestedCrontabLines,
      guide: this.buildBackupGuide(cfg, script, hostCron),
    };
  }

  private buildBackupGuide(
    cfg: BackupConfig,
    scriptPath: string,
    hostCron: string,
  ): BackupGuide {
    const repoScript = 'tabaghe-api/scripts/tabagheh_pg_backup.sh';
    const crontabLine = `RETENTION_DAYS=${cfg.retentionDays} BACKUP_DIR=${cfg.backupDir} ${hostCron} ${scriptPath} >>/var/log/tabagheh_pg_backup.log 2>&1`;

    return {
      sections: [
        {
          id: 'overview',
          title: 'سه روش بک‌اپ',
          paragraphs: [
            'بک‌اپ‌ها روی دیسک سرور (مسیر زیر) ذخیره می‌شوند و از همین پنل قابل دانلود هستند.',
          ],
          bullets: [
            'دکمه «بک‌اپ همین الان» — فوری، بدون cron',
            'زمان‌بندی داخل API — وقتی backend همیشه روشن است (حالت interval)',
            'cron روی VPS — توصیه برای production و Docker (مستقل از ری‌استارت پنل)',
          ],
        },
        {
          id: 'panel',
          title: '۱) استفاده از همین پنل',
          paragraphs: [
            'با GODADMIN وارد این صفحه شوید. پس از هر بک‌اپ موفق، فایل در لیست «فایل‌های بک‌اپ» ظاهر می‌شود.',
          ],
          bullets: [
            '«بک‌اپ همین الان» — یک فایل tabagheh_db_YYYY-MM-DD_HHMM.dump می‌سازد',
            '«دانلود» — فایل را روی کامپیوتر خودتان ذخیره کنید (آفلاین / آرشیو)',
            '«حذف» — فقط فایل روی سرور را پاک می‌کند؛ دیتابیس زنده دست‌نخورده می‌ماند',
            `مسیر ذخیره پیش‌فرض: ${cfg.backupDir}`,
          ],
        },
        {
          id: 'api_schedule',
          title: '۲) زمان‌بندی داخل API',
          paragraphs: [
            'در بخش تنظیمات، «زمان‌بندی خودکار» را فعال و حالت را «هر چند ساعت» انتخاب کنید. Nest هر ۶۰ ثانیه بررسی می‌کند.',
          ],
          bullets: [
            'سرویس backend باید دائماً در حال اجرا باشد (مثلاً systemd یا docker compose up)',
            'اگر API خاموش باشد، بک‌اپ زمان‌بندی‌شده اجرا نمی‌شود',
            `نگهداری خودکار: فایل‌های قدیمی‌تر از ${cfg.retentionDays} روز حذف می‌شوند`,
          ],
        },
        {
          id: 'host_cron',
          title: '۳) بک‌اپ روی VPS با cron (توصیه)',
          paragraphs: [
            'اسکریپت رسمی از داخل کانتینر Postgres یا با pg_dump بک‌اپ می‌گیرد. روی هاست نصب کنید و با cron اجرا کنید.',
          ],
          bullets: [
            'حتی اگر پنل یا API خاموش باشد، cron روی سرور کار می‌کند',
            'همان مسیر backupDir را در پنل و در crontab یکسان نگه دارید',
            'لاگ پیشنهادی: /var/log/tabagheh_pg_backup.log',
          ],
          commands: [
            {
              label: 'نصب اسکریپت از ریپو (روی VPS)',
              command: `install -m 755 /var/www/tabagheh/${repoScript} ${scriptPath}`,
            },
            {
              label: 'اجرای دستی یک‌بار (تست)',
              command: `RETENTION_DAYS=${cfg.retentionDays} BACKUP_DIR=${cfg.backupDir} ${scriptPath}`,
            },
            {
              label: 'افزودن به crontab',
              command: crontabLine,
            },
            {
              label: 'مشاهده crontab',
              command: 'crontab -l | tail -n 10',
            },
          ],
        },
        {
          id: 'env',
          title: 'متغیرهای محیطی (docker-compose / هاست)',
          paragraphs: [
            'در docker-compose برای سرویس API از قبل volume و مسیر اسکریپت تنظیم شده است.',
          ],
          bullets: [
            `BACKUP_DIR — مسیر داخل کانتینر API (پیش‌فرض: ${cfg.backupDir})`,
            'BACKUP_SCRIPT_PATH — مسیر اسکریپت داخل کانتینر (مثلاً /scripts/tabagheh_pg_backup.sh)',
            'BACKUP_HOST_DIR — پوشه روی هاست که به /var/backups/tabagheh mount می‌شود',
            'POSTGRES_CONTAINER / BACKUP_POSTGRES_CONTAINER — نام کانتینر Postgres (مثلاً tabagheh-db یا tabagheh_postgres)',
            'POSTGRES_USER / POSTGRES_DB — مطابق docker-compose',
          ],
        },
        {
          id: 'restore',
          title: 'بازیابی (restore) — فقط روی سرور',
          paragraphs: [
            'قبل از restore روی دیتابیس اصلی، حتماً یک بک‌اپ تازه بگیرید. برای تست، ابتدا روی دیتابیس موقت restore کنید.',
          ],
          bullets: [
            'فرمت فایل: PostgreSQL custom dump (.dump) — با pg_restore باز می‌شود',
            'از پنل فایل را دانلود کنید یا از مسیر backupDir روی VPS استفاده کنید',
          ],
          commands: [
            {
              label: 'تست restore روی دیتابیس موقت',
              command: [
                'docker exec -t tabagheh_postgres dropdb -U tabagheh_maindb --if-exists tabagheh_restore_test',
                'docker exec -t tabagheh_postgres createdb -U tabagheh_maindb tabagheh_restore_test',
                `latest="$(ls -1t ${cfg.backupDir}/tabagheh_db_*.dump | head -n 1)"`,
                'docker exec -i tabagheh_postgres pg_restore -U tabagheh_maindb -d tabagheh_restore_test --no-owner --no-privileges < "$latest"',
                'docker exec -t tabagheh_postgres psql -U tabagheh_maindb -d tabagheh_restore_test -c "select to_regclass(\'_prisma_migrations\');"',
              ].join('\n'),
            },
            {
              label: 'restore روی دیتابیس اصلی (خطرناک — فقط در قطعی)',
              command: [
                '# توقف API توصیه می‌شود',
                `latest="$(ls -1t ${cfg.backupDir}/tabagheh_db_*.dump | head -n 1)"`,
                'docker exec -i tabagheh_postgres pg_restore -U tabagheh_maindb -d tabagheh_db --clean --if-exists --no-owner --no-privileges < "$latest"',
              ].join('\n'),
            },
          ],
        },
        {
          id: 'troubleshoot',
          title: 'عیب‌یابی',
          paragraphs: [],
          bullets: [
            'pg_dump یافت نشد — postgresql-client نصب کنید یا preferHostScript + BACKUP_SCRIPT_PATH را فعال کنید',
            'پوشه backupDir باید برای کاربر اجراکننده API قابل نوشتن باشد (chmod 700)',
            'در docker exec برای dump باینری از -t استفاده نکنید (خروجی خراب می‌شود)',
            'اگر بک‌اپ از پنل موفق است ولی cron نه — لاگ /var/log/tabagheh_pg_backup.log را ببینید',
            'فایل‌های قدیمی‌تر از retentionDays خودکار پاک می‌شوند (پنل و اسکریپت)',
          ],
        },
      ],
    };
  }

  private async executeBackup(
    cfg: BackupConfig,
  ): Promise<{ fileName: string; path: string }> {
    await this.ensureBackupDir(cfg.backupDir);
    await this.pruneOldBackups(cfg.backupDir, cfg.retentionDays);

    const errors: string[] = [];
    const script = this.hostScriptPath();

    if (cfg.preferHostScript && script) {
      try {
        return await this.runHostScript(cfg, script);
      } catch (err) {
        errors.push(this.errMsg(err, 'اسکریپت هاست'));
      }
    }

    try {
      return await this.runDockerPgDump(cfg);
    } catch (err) {
      errors.push(this.errMsg(err, 'docker exec'));
    }

    try {
      return await this.runPgDump(cfg);
    } catch (err) {
      errors.push(this.errMsg(err, 'pg_dump'));
    }

    throw new ServiceUnavailableException(
      [
        'بک‌اپ ناموفق — هیچ روشی جواب نداد.',
        ...errors,
        'راه‌حل: docker compose build --no-cache backend && docker compose up -d backend',
        'در .env مقدار BACKUP_POSTGRES_CONTAINER را برابر نام کانتینر Postgres بگذارید (مثلاً tabagheh-db)',
        'برای مانیتور Docker: volume /var/run/docker.sock:/var/run/docker.sock',
      ].join(' '),
    );
  }

  private errMsg(err: unknown, prefix: string): string {
    const msg = err instanceof Error ? err.message : String(err);
    return `${prefix}: ${msg}`;
  }

  private runDockerPgDump(
    cfg: BackupConfig,
  ): Promise<{ fileName: string; path: string }> {
    if (!this.canRunDocker()) {
      return Promise.reject(
        new Error('Docker CLI یا socket در دسترس نیست'),
      );
    }

    const container = this.resolvePostgresContainer();
    if (!this.isContainerRunning(container)) {
      return Promise.reject(
        new Error(
          `کانتینر Postgres «${container}» در حال اجرا نیست — BACKUP_POSTGRES_CONTAINER را در .env اصلاح کنید`,
        ),
      );
    }

    const user = process.env.BACKUP_POSTGRES_USER ?? 'tabagheh_maindb';
    const db = process.env.BACKUP_POSTGRES_DB ?? 'tabagheh_db';
    const ts = this.timestamp();
    const fileName = `tabagheh_db_${ts}.dump`;
    const outPath = join(cfg.backupDir, fileName);

    return new Promise((resolve, reject) => {
      const child = spawn(
        'docker',
        [
          'exec',
          container,
          'pg_dump',
          '-U',
          user,
          '-d',
          db,
          '--format=custom',
        ],
        { env: process.env },
      );

      const fileStream = createWriteStream(outPath);
      let stderr = '';

      child.stdout.pipe(fileStream);
      child.stderr.on('data', (d) => (stderr += String(d)));
      child.on('error', (err) => {
        fileStream.destroy();
        if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
          reject(new Error('docker CLI یافت نشد — image backend را rebuild کنید'));
          return;
        }
        reject(err);
      });

      fileStream.on('error', reject);

      child.on('close', (code) => {
        fileStream.end();
        if (code !== 0) {
          reject(new Error(stderr.trim() || `docker exec pg_dump exit ${code}`));
          return;
        }
        resolve({ fileName, path: outPath });
      });
    });
  }

  private canRunDocker(): boolean {
    try {
      const r = spawnSync('docker', ['info'], {
        encoding: 'utf8',
        timeout: 5000,
      });
      return r.status === 0;
    } catch {
      return false;
    }
  }

  private runHostScript(
    cfg: BackupConfig,
    scriptPath: string,
  ): Promise<{ fileName: string; path: string }> {
    return new Promise((resolve, reject) => {
      const env = {
        ...process.env,
        BACKUP_DIR: cfg.backupDir,
        RETENTION_DAYS: String(cfg.retentionDays),
        POSTGRES_CONTAINER: this.resolvePostgresContainer(),
        POSTGRES_USER: process.env.BACKUP_POSTGRES_USER ?? 'tabagheh_maindb',
        POSTGRES_DB: process.env.BACKUP_POSTGRES_DB ?? 'tabagheh_db',
      };

      const child = spawn('bash', [scriptPath], { env });
      let stdout = '';
      let stderr = '';
      child.stdout.on('data', (d) => (stdout += String(d)));
      child.stderr.on('data', (d) => (stderr += String(d)));
      child.on('error', (err) => reject(err));
      child.on('close', (code) => {
        if (code !== 0) {
          reject(new Error(stderr.trim() || `اسکریپت با کد ${code} خارج شد`));
          return;
        }
        const line = stdout.trim().split('\n').pop()?.trim();
        if (line && line.endsWith('.dump')) {
          const fileName = line.split(/[/\\]/).pop()!;
          return resolve({ fileName, path: line });
        }
        this.findLatestBackup(cfg.backupDir).then(resolve).catch(reject);
      });
    });
  }

  private runPgDump(
    cfg: BackupConfig,
  ): Promise<{ fileName: string; path: string }> {
    const dbUrl = this.configService.get<string>('DATABASE_URL');
    if (!dbUrl) {
      throw new ServiceUnavailableException('DATABASE_URL تنظیم نشده است');
    }

    const ts = this.timestamp();
    const fileName = `tabagheh_db_${ts}.dump`;
    const path = join(cfg.backupDir, fileName);

    return new Promise((resolve, reject) => {
      const child = spawn(
        'pg_dump',
        [dbUrl, '--format=custom', '--file', path],
        {
          env: process.env,
        },
      );
      let stderr = '';
      child.stderr.on('data', (d) => (stderr += String(d)));
      child.on('error', (err) => {
        if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
          reject(
            new Error(
              'pg_dump یافت نشد. postgresql-client را نصب کنید یا BACKUP_SCRIPT_PATH را ست کنید',
            ),
          );
          return;
        }
        reject(err);
      });
      child.on('close', (code) => {
        if (code !== 0) {
          reject(new Error(stderr.trim() || `pg_dump exit ${code}`));
          return;
        }
        resolve({ fileName, path });
      });
    });
  }

  private async findLatestBackup(
    dir: string,
  ): Promise<{ fileName: string; path: string }> {
    const files = await this.listFiles();
    if (!files.length) {
      throw new Error('پس از اسکریپت، فایل بک‌اپی یافت نشد');
    }
    const fileName = files[0].fileName;
    return { fileName, path: join(dir, fileName) };
  }

  private async pruneOldBackups(
    dir: string,
    retentionDays: number,
  ): Promise<void> {
    const cutoff = Date.now() - retentionDays * 24 * 60 * 60 * 1000;
    const files = await this.listFiles().catch(() => [] as BackupFileItem[]);
    for (const f of files) {
      if (new Date(f.createdAt).getTime() < cutoff) {
        await unlink(join(dir, f.fileName)).catch(() => undefined);
      }
    }
  }

  private async resolveBackupPath(fileName: string): Promise<string> {
    if (!this.isValidBackupFileName(fileName)) {
      throw new BadRequestException('نام فایل نامعتبر است');
    }
    const cfg = await this.loadConfig();
    const path = resolve(cfg.backupDir, fileName);
    if (!path.startsWith(resolve(cfg.backupDir))) {
      throw new BadRequestException('مسیر نامعتبر');
    }
    await access(path);
    return path;
  }

  private isValidBackupFileName(name: string): boolean {
    return (
      /^tabagheh_db_[\d]{4}-[\d]{2}-[\d]{2}_[\d]{4}\.dump$/.test(name) ||
      /^tabagheh_db_upload_[\d]{4}-[\d]{2}-[\d]{2}_[\d]{4}\.dump$/.test(name) ||
      /^tabagheh_db_.+\.dump$/.test(name)
    );
  }

  private async ensureBackupDir(dir: string): Promise<void> {
    await mkdir(dir, { recursive: true, mode: 0o700 });
  }

  private normalizeBackupDir(dir: string): string {
    const fromEnv = this.configService.get<string>('BACKUP_DIR');
    const base = (dir || fromEnv || DEFAULT_CONFIG.backupDir).trim();
    return base.replace(/\\/g, '/');
  }

  private hostScriptPath(): string | null {
    const p = this.configService.get<string>('BACKUP_SCRIPT_PATH');
    return p?.trim() || null;
  }

  private timestamp(): string {
    const d = new Date();
    const pad = (n: number) => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}_${pad(d.getHours())}${pad(d.getMinutes())}`;
  }

  private intervalToCron(hours: number): string {
    if (hours === 1) return '0 * * * *';
    if (hours === 3) return '0 */3 * * *';
    if (hours === 6) return '0 */6 * * *';
    if (hours === 12) return '0 */12 * * *';
    if (hours === 168) return '15 3 * * 0';
    return '15 3 * * *';
  }

  private computeNextRunAt(
    enabled: boolean,
    intervalHours: number,
    lastRunAt: string | null,
  ): string | null {
    if (!enabled) return null;
    const base = lastRunAt ? new Date(lastRunAt).getTime() : Date.now();
    return new Date(base + intervalHours * 60 * 60 * 1000).toISOString();
  }

  private async loadConfig(): Promise<BackupConfig> {
    const row = await this.prisma.systemSetting.findUnique({
      where: { key: BACKUP_CONFIG_KEY },
    });
    if (!row?.value) {
      return {
        ...DEFAULT_CONFIG,
        backupDir: this.normalizeBackupDir(DEFAULT_CONFIG.backupDir),
      };
    }
    try {
      const parsed = JSON.parse(row.value) as Partial<BackupConfig>;
      return {
        ...DEFAULT_CONFIG,
        ...parsed,
        backupDir: this.normalizeBackupDir(
          parsed.backupDir ?? DEFAULT_CONFIG.backupDir,
        ),
      };
    } catch {
      return {
        ...DEFAULT_CONFIG,
        backupDir: this.normalizeBackupDir(DEFAULT_CONFIG.backupDir),
      };
    }
  }

  private buildFilesSummary(files: BackupFileItem[]): BackupFilesSummary {
    if (!files.length) {
      return {
        fileCount: 0,
        totalBytes: 0,
        latestFileName: null,
        latestCreatedAt: null,
        latestSizeBytes: null,
      };
    }
    const latest = files[0];
    return {
      fileCount: files.length,
      totalBytes: files.reduce((s, f) => s + f.sizeBytes, 0),
      latestFileName: latest.fileName,
      latestCreatedAt: latest.createdAt,
      latestSizeBytes: latest.sizeBytes,
    };
  }

  private async syncConfigFromDiskFiles(
    cfg: BackupConfig,
    files: BackupFileItem[],
  ): Promise<BackupConfig> {
    if (!files.length) return cfg;

    const latest = files[0];
    const latestTime = new Date(latest.createdAt).getTime();
    const lastRunTime = cfg.lastRunAt
      ? new Date(cfg.lastRunAt).getTime()
      : 0;

    const diskIsNewer =
      !cfg.lastFileName ||
      latest.fileName !== cfg.lastFileName ||
      latestTime > lastRunTime + 60_000;

    if (!diskIsNewer) return cfg;

    const synced: BackupConfig = {
      ...cfg,
      lastFileName: latest.fileName,
      lastFileSizeBytes: latest.sizeBytes,
      lastRunAt: latest.createdAt,
      lastStatus: 'success',
      lastError: null,
    };
    await this.saveConfig(synced);
    return synced;
  }

  private resolvePostgresContainer(): string {
    const explicit =
      process.env.BACKUP_POSTGRES_CONTAINER?.trim() ||
      process.env.POSTGRES_CONTAINER?.trim();
    if (explicit) return explicit;

    const candidates = [
      'tabagheh-db',
      'tabagheh_postgres',
      'postgres_db',
      'tabagheh-db-1',
    ];
    for (const name of candidates) {
      if (this.isContainerRunning(name)) return name;
    }
    return 'tabagheh_postgres';
  }

  private isContainerRunning(name: string): boolean {
    try {
      const r = spawnSync('docker', ['ps', '--format', '{{.Names}}'], {
        encoding: 'utf8',
        timeout: 5000,
      });
      if (r.status !== 0) return false;
      return r.stdout
        .split('\n')
        .map((l) => l.trim())
        .includes(name);
    } catch {
      return false;
    }
  }

  private async saveConfig(cfg: BackupConfig): Promise<void> {
    await this.prisma.systemSetting.upsert({
      where: { key: BACKUP_CONFIG_KEY },
      create: {
        key: BACKUP_CONFIG_KEY,
        value: JSON.stringify(cfg),
        description: 'تنظیمات بک‌اپ GODADMIN',
      },
      update: { value: JSON.stringify(cfg) },
    });
  }
}
