import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { existsSync, mkdirSync, writeFileSync } from 'fs';
import { dirname, join } from 'path';
import { spawnSync } from 'child_process';
import { PrismaService } from '../../../infrastructure/prisma/prisma.service';
import {
  CreateGiteaIpAllowlistDto,
  UpdateGiteaIpAllowlistDto,
} from '../dto/admin-gitea-ip-allowlist.dto';

const ENFORCEMENT_SETTING_KEY = 'gitea_ip_allowlist.enforcement_enabled';

export type GiteaIpAllowlistSyncResult = {
  filePath: string;
  written: boolean;
  reloadAttempted: boolean;
  reloadOk: boolean;
  message: string;
};

@Injectable()
export class AdminGiteaIpAllowlistService {
  private readonly logger = new Logger(AdminGiteaIpAllowlistService.name);

  constructor(private readonly prisma: PrismaService) {}

  private normalizeCidr(raw: string): string {
    const v = raw.trim();
    if (!v.includes('/')) return `${v}/32`;
    return v;
  }

  private resolveAllowlistFilePath(): string {
    if (process.env.GITEA_IP_ALLOWLIST_FILE?.trim()) {
      return process.env.GITEA_IP_ALLOWLIST_FILE.trim();
    }
    // Prefer ops mount (/app/ops/nginx in production compose); uploads as fallback.
    const opsPath = join(process.cwd(), 'ops', 'nginx', 'gitea-ip-allowlist.conf');
    if (existsSync(dirname(opsPath)) || existsSync(opsPath)) return opsPath;
    return join(process.cwd(), 'uploads', 'ops', 'gitea-ip-allowlist.conf');
  }

  async getConfig() {
    const row = await this.prisma.systemSetting.findUnique({
      where: { key: ENFORCEMENT_SETTING_KEY },
    });
    const enforcementEnabled = row?.value === 'true' || row?.value === '1';
    return {
      enforcementEnabled,
      alwaysAllow: this.alwaysAllowCidrs(),
      filePath: this.resolveAllowlistFilePath(),
      reloadCmdConfigured: Boolean(process.env.GITEA_IP_ALLOWLIST_RELOAD_CMD?.trim()),
    };
  }

  async setEnforcementEnabled(enabled: boolean) {
    await this.prisma.systemSetting.upsert({
      where: { key: ENFORCEMENT_SETTING_KEY },
      create: {
        key: ENFORCEMENT_SETTING_KEY,
        value: enabled ? 'true' : 'false',
        description: 'اعمال محدودیت IP روی دسترسی Gitea (nginx allowlist)',
      },
      update: { value: enabled ? 'true' : 'false' },
    });
    const sync = await this.syncNginxAllowlist();
    return { ...(await this.getConfig()), sync };
  }

  list() {
    return this.prisma.giteaIpAllowlistEntry.findMany({
      orderBy: [{ enabled: 'desc' }, { name: 'asc' }, { createdAt: 'asc' }],
    });
  }

  async get(id: string) {
    const row = await this.prisma.giteaIpAllowlistEntry.findUnique({ where: { id } });
    if (!row) throw new NotFoundException('رکورد یافت نشد');
    return row;
  }

  async create(dto: CreateGiteaIpAllowlistDto) {
    const ipCidr = this.normalizeCidr(dto.ipCidr);
    try {
      const row = await this.prisma.giteaIpAllowlistEntry.create({
        data: {
          name: dto.name.trim(),
          ipCidr,
          enabled: dto.enabled ?? true,
          notes: dto.notes?.trim() || null,
        },
      });
      const sync = await this.syncNginxAllowlist();
      return { ...row, sync };
    } catch (e: unknown) {
      if ((e as { code?: string })?.code === 'P2002') {
        throw new ConflictException('این IP/CIDR قبلاً ثبت شده است');
      }
      throw e;
    }
  }

  async update(id: string, dto: UpdateGiteaIpAllowlistDto) {
    await this.get(id);
    const data: {
      name?: string;
      ipCidr?: string;
      enabled?: boolean;
      notes?: string | null;
    } = {};
    if (dto.name !== undefined) data.name = dto.name.trim();
    if (dto.ipCidr !== undefined) data.ipCidr = this.normalizeCidr(dto.ipCidr);
    if (dto.enabled !== undefined) data.enabled = dto.enabled;
    if (dto.notes !== undefined) data.notes = dto.notes?.trim() || null;

    try {
      const row = await this.prisma.giteaIpAllowlistEntry.update({
        where: { id },
        data,
      });
      const sync = await this.syncNginxAllowlist();
      return { ...row, sync };
    } catch (e: unknown) {
      if ((e as { code?: string })?.code === 'P2002') {
        throw new ConflictException('این IP/CIDR قبلاً ثبت شده است');
      }
      throw e;
    }
  }

  async remove(id: string) {
    await this.get(id);
    await this.prisma.giteaIpAllowlistEntry.delete({ where: { id } });
    const sync = await this.syncNginxAllowlist();
    return { ok: true, sync };
  }

  /** Force rewrite nginx snippet from DB (e.g. after ops path change). */
  async resync() {
    const sync = await this.syncNginxAllowlist();
    return { ...(await this.getConfig()), sync };
  }

  private alwaysAllowCidrs(): string[] {
    const fromEnv = (process.env.GITEA_IP_ALLOWLIST_ALWAYS ?? '127.0.0.1')
      .split(/[,;\s]+/)
      .map((s) => s.trim())
      .filter(Boolean)
      .map((s) => this.normalizeCidr(s));
    return [...new Set(fromEnv.length ? fromEnv : ['127.0.0.1/32'])];
  }

  async syncNginxAllowlist(): Promise<GiteaIpAllowlistSyncResult> {
    const filePath = this.resolveAllowlistFilePath();
    const cfg = await this.getConfig();
    const rows = await this.prisma.giteaIpAllowlistEntry.findMany({
      where: { enabled: true },
      orderBy: { name: 'asc' },
    });

    const lines: string[] = [
      '# Managed by Tabagheh admin (Gitea IP allowlist) — do not edit by hand',
      `# Generated at ${new Date().toISOString()}`,
      '',
    ];

    if (!cfg.enforcementEnabled) {
      lines.push('# Enforcement DISABLED — all clients allowed');
      lines.push('# (no allow/deny rules)');
      lines.push('');
    } else {
      if (rows.length === 0) {
        this.logger.warn(
          'Gitea IP enforcement enabled but no enabled entries — only always-allow CIDRs will pass',
        );
      }
      for (const cidr of this.alwaysAllowCidrs()) {
        lines.push(`allow ${cidr};  # always-allow`);
      }
      for (const row of rows) {
        const comment = row.name.replace(/[^\w\u0600-\u06FF\s.-]/g, '').slice(0, 80);
        lines.push(`allow ${row.ipCidr};  # ${comment}`);
      }
      lines.push('deny all;');
      lines.push('');
    }

    let written = false;
    let message = '';
    try {
      mkdirSync(dirname(filePath), { recursive: true });
      writeFileSync(filePath, lines.join('\n'), 'utf8');
      written = true;
      message = `فایل نوشته شد: ${filePath}`;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      this.logger.error(`Failed writing Gitea allowlist file ${filePath}: ${msg}`);
      throw new BadRequestException(
        `ذخیره در دیتابیس انجام شد ولی نوشتن فایل nginx ناموفق بود: ${msg}. مسیر GITEA_IP_ALLOWLIST_FILE را روی سرور تنظیم کنید.`,
      );
    }

    const reloadCmd = process.env.GITEA_IP_ALLOWLIST_RELOAD_CMD?.trim();
    let reloadAttempted = false;
    let reloadOk = false;
    if (reloadCmd) {
      reloadAttempted = true;
      const r = spawnSync('sh', ['-c', reloadCmd], {
        encoding: 'utf8',
        timeout: 30_000,
        env: process.env,
      });
      reloadOk = r.status === 0;
      if (!reloadOk) {
        const errOut = (r.stderr || r.stdout || r.error?.message || 'unknown').toString().slice(0, 300);
        this.logger.warn(`Gitea allowlist reload failed: ${errOut}`);
        message += ` — reload ناموفق: ${errOut}`;
      } else {
        message += ' — nginx reload OK';
      }
    } else {
      message +=
        ' — برای اعمال فوری، روی هاست nginx را reload کنید یا GITEA_IP_ALLOWLIST_RELOAD_CMD را ست کنید';
    }

    return { filePath, written, reloadAttempted, reloadOk, message };
  }
}
