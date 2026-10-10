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
  UpdateGiteaIpAllowlistConfigDto,
  UpdateGiteaIpAllowlistDto,
} from '../dto/admin-gitea-ip-allowlist.dto';

const ENFORCEMENT_SETTING_KEY = 'gitea_ip_allowlist.enforcement_enabled';
const PAGE_BRAND_KEY = 'gitea_ip_allowlist.forbidden_brand';
const PAGE_TITLE_KEY = 'gitea_ip_allowlist.forbidden_title';
const PAGE_MESSAGE_KEY = 'gitea_ip_allowlist.forbidden_message';
const PAGE_CODE_KEY = 'gitea_ip_allowlist.forbidden_code';
const PAGE_HINT_KEY = 'gitea_ip_allowlist.forbidden_hint';

const DEFAULT_FORBIDDEN_PAGE = {
  brand: 'TABAGHEH · GIT',
  title: 'آدرس IP شما مجاز نیست',
  message:
    'دسترسی به مخزن کد فقط برای آدرس‌های تأییدشده فعال است. اگر باید به این سرویس وصل شوید، از ادمین بخواهید IP شما را به فهرست مجاز اضافه کند.',
  code: '403 · IP_NOT_ALLOWED',
  hint: 'این صفحه برای مرورگر است. کلاینت Git هم با کد HTTP 403 رد می‌شود.',
};

export type GiteaIpAllowlistSyncResult = {
  filePath: string;
  written: boolean;
  reloadAttempted: boolean;
  reloadOk: boolean;
  message: string;
  htmlPath?: string;
};

export type GiteaForbiddenPage = typeof DEFAULT_FORBIDDEN_PAGE;

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
    const opsPath = join(process.cwd(), 'ops', 'nginx', 'gitea-ip-allowlist.conf');
    if (existsSync(dirname(opsPath)) || existsSync(opsPath)) return opsPath;
    return join(process.cwd(), 'uploads', 'ops', 'gitea-ip-allowlist.conf');
  }

  private resolveForbiddenHtmlPath(): string {
    if (process.env.GITEA_IP_FORBIDDEN_HTML?.trim()) {
      return process.env.GITEA_IP_FORBIDDEN_HTML.trim();
    }
    return join(dirname(this.resolveAllowlistFilePath()), 'gitea-ip-forbidden.html');
  }

  private escapeHtml(s: string): string {
    return s
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  private async readSetting(key: string): Promise<string | null> {
    const row = await this.prisma.systemSetting.findUnique({ where: { key } });
    return row?.value ?? null;
  }

  private async writeSetting(key: string, value: string, description: string) {
    await this.prisma.systemSetting.upsert({
      where: { key },
      create: { key, value, description },
      update: { value },
    });
  }

  async getForbiddenPage(): Promise<GiteaForbiddenPage> {
    const [brand, title, message, code, hint] = await Promise.all([
      this.readSetting(PAGE_BRAND_KEY),
      this.readSetting(PAGE_TITLE_KEY),
      this.readSetting(PAGE_MESSAGE_KEY),
      this.readSetting(PAGE_CODE_KEY),
      this.readSetting(PAGE_HINT_KEY),
    ]);
    return {
      brand: brand?.trim() || DEFAULT_FORBIDDEN_PAGE.brand,
      title: title?.trim() || DEFAULT_FORBIDDEN_PAGE.title,
      message: message?.trim() || DEFAULT_FORBIDDEN_PAGE.message,
      code: code?.trim() || DEFAULT_FORBIDDEN_PAGE.code,
      hint: hint?.trim() || DEFAULT_FORBIDDEN_PAGE.hint,
    };
  }

  /** When unset, we still try safe default nginx reload cmds so admin IP changes apply immediately. */
  private isAutoReloadDisabled(): boolean {
    const v = (process.env.GITEA_IP_ALLOWLIST_AUTO_RELOAD ?? '1').trim().toLowerCase();
    return v === '0' || v === 'false' || v === 'off' || v === 'no';
  }

  private runningInDocker(): boolean {
    try {
      return existsSync('/.dockerenv');
    } catch {
      return false;
    }
  }

  private resolveReloadCommands(): string[] {
    const fromEnv = process.env.GITEA_IP_ALLOWLIST_RELOAD_CMD?.trim();
    if (fromEnv) return [fromEnv];
    if (this.isAutoReloadDisabled()) return [];

    // Prefer test-then-reload; sudo -n for passwordless sudoers common on app hosts.
    const hostCmds = [
      'nginx -t && nginx -s reload',
      'sudo -n nginx -t && sudo -n nginx -s reload',
      'systemctl reload nginx',
      'sudo -n systemctl reload nginx',
    ];

    // API usually runs in Docker without nginx/sudo — try host via docker.sock if mounted.
    // Requires: docker CLI in image + /var/run/docker.sock, and host nginx (or named container).
    const dockerHost = (
      process.env.GITEA_IP_ALLOWLIST_DOCKER_HOST_NGINX ?? '1'
    )
      .trim()
      .toLowerCase();
    const dockerGateway = (
      process.env.GITEA_IP_ALLOWLIST_DOCKER_GATEWAY ?? 'tabagheh-gateway'
    ).trim();
    const dockerCmds: string[] = [];
    if (dockerHost !== '0' && dockerHost !== 'false' && dockerHost !== 'off') {
      // nsenter into PID 1 mount namespace (works when container is privileged or has CAP_SYS_ADMIN)
      dockerCmds.push(
        'nsenter -t 1 -m -u -i -n -- nginx -t && nsenter -t 1 -m -u -i -n -- nginx -s reload',
      );
      // docker CLI against host socket
      dockerCmds.push(
        'docker run --rm --privileged --pid=host alpine:3.20 nsenter -t 1 -m -u -i -n -- sh -c "nginx -t && nginx -s reload"',
      );
    }
    if (dockerGateway) {
      dockerCmds.push(
        `docker exec ${dockerGateway} nginx -t && docker exec ${dockerGateway} nginx -s reload`,
      );
    }

    if (this.runningInDocker()) {
      return [...dockerCmds, ...hostCmds];
    }
    return [...hostCmds, ...dockerCmds];
  }

  private runShell(cmd: string): { ok: boolean; output: string } {
    const isWin = process.platform === 'win32';
    const r = spawnSync(isWin ? 'cmd' : 'sh', isWin ? ['/c', cmd] : ['-c', cmd], {
      encoding: 'utf8',
      timeout: 30_000,
      env: process.env,
    });
    const output = (r.stderr || r.stdout || r.error?.message || '').toString().trim().slice(0, 400);
    return { ok: r.status === 0, output };
  }

  async getConfig() {
    const row = await this.prisma.systemSetting.findUnique({
      where: { key: ENFORCEMENT_SETTING_KEY },
    });
    const enforcementEnabled = row?.value === 'true' || row?.value === '1';
    const reloadCmds = this.resolveReloadCommands();
    return {
      enforcementEnabled,
      alwaysAllow: this.alwaysAllowCidrs(),
      filePath: this.resolveAllowlistFilePath(),
      forbiddenHtmlPath: this.resolveForbiddenHtmlPath(),
      reloadCmdConfigured: reloadCmds.length > 0,
      forbiddenPage: await this.getForbiddenPage(),
    };
  }

  async updateConfig(dto: UpdateGiteaIpAllowlistConfigDto) {
    if (dto.enforcementEnabled !== undefined) {
      await this.writeSetting(
        ENFORCEMENT_SETTING_KEY,
        dto.enforcementEnabled ? 'true' : 'false',
        'اعمال محدودیت IP روی دسترسی Gitea (nginx allowlist)',
      );
    }
    if (dto.forbiddenBrand !== undefined) {
      await this.writeSetting(PAGE_BRAND_KEY, dto.forbiddenBrand.trim(), 'برند صفحه 403 گیت');
    }
    if (dto.forbiddenTitle !== undefined) {
      await this.writeSetting(PAGE_TITLE_KEY, dto.forbiddenTitle.trim(), 'عنوان صفحه 403 گیت');
    }
    if (dto.forbiddenMessage !== undefined) {
      await this.writeSetting(PAGE_MESSAGE_KEY, dto.forbiddenMessage.trim(), 'متن صفحه 403 گیت');
    }
    if (dto.forbiddenCode !== undefined) {
      await this.writeSetting(PAGE_CODE_KEY, dto.forbiddenCode.trim(), 'کد صفحه 403 گیت');
    }
    if (dto.forbiddenHint !== undefined) {
      await this.writeSetting(PAGE_HINT_KEY, dto.forbiddenHint.trim(), 'راهنمای صفحه 403 گیت');
    }

    const sync = await this.syncAll();
    return { ...(await this.getConfig()), sync };
  }

  /** @deprecated use updateConfig */
  async setEnforcementEnabled(enabled: boolean) {
    return this.updateConfig({ enforcementEnabled: enabled });
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

  async resync() {
    const sync = await this.syncAll();
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

  private buildForbiddenHtml(page: GiteaForbiddenPage): string {
    const brand = this.escapeHtml(page.brand);
    const title = this.escapeHtml(page.title);
    const message = this.escapeHtml(page.message).replace(/\n/g, '<br/>');
    const code = this.escapeHtml(page.code);
    const hint = this.escapeHtml(page.hint);
    return `<!DOCTYPE html>
<html lang="fa" dir="rtl">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <meta name="robots" content="noindex, nofollow" />
  <title>${title} | طبقه</title>
  <style>
    :root { --bg:#0f1419; --card:#1a222c; --text:#e8eef4; --muted:#8b9aab; --accent:#3d8bfd; --line:rgba(255,255,255,.08); }
    *{box-sizing:border-box}
    body{margin:0;min-height:100vh;font-family:"Segoe UI",Tahoma,sans-serif;color:var(--text);display:grid;place-items:center;padding:24px;
      background:radial-gradient(900px 500px at 10% -10%,rgba(61,139,253,.18),transparent 55%),var(--bg)}
    .card{width:min(520px,100%);background:var(--card);border:1px solid var(--line);border-radius:16px;padding:36px 32px;box-shadow:0 24px 60px rgba(0,0,0,.35)}
    .brand{font-size:13px;letter-spacing:.08em;color:var(--accent);font-weight:700;margin-bottom:18px}
    h1{margin:0 0 12px;font-size:1.55rem;font-weight:800;line-height:1.4}
    p{margin:0;color:var(--muted);font-size:.98rem;line-height:1.9}
    .code{margin-top:22px;padding:12px 14px;border-radius:10px;background:rgba(0,0,0,.28);border:1px solid var(--line);font-family:ui-monospace,Consolas,monospace;font-size:12px;color:#c5d4e3;direction:ltr;text-align:left}
    .hint{margin-top:18px;font-size:.85rem;color:var(--muted)}
  </style>
</head>
<body>
  <main class="card">
    <div class="brand">${brand}</div>
    <h1>${title}</h1>
    <p>${message}</p>
    <div class="code">${code}</div>
    <p class="hint">${hint}</p>
  </main>
</body>
</html>
`;
  }

  async syncForbiddenHtml(): Promise<{ htmlPath: string; written: boolean }> {
    const page = await this.getForbiddenPage();
    const htmlPath = this.resolveForbiddenHtmlPath();
    try {
      mkdirSync(dirname(htmlPath), { recursive: true });
      writeFileSync(htmlPath, this.buildForbiddenHtml(page), 'utf8');
      return { htmlPath, written: true };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      this.logger.error(`Failed writing forbidden HTML ${htmlPath}: ${msg}`);
      throw new BadRequestException(`نوشتن صفحه 403 ناموفق بود: ${msg}`);
    }
  }

  async syncAll(): Promise<GiteaIpAllowlistSyncResult> {
    const allow = await this.syncNginxAllowlist();
    const html = await this.syncForbiddenHtml();
    return {
      ...allow,
      htmlPath: html.htmlPath,
      message: `${allow.message} | صفحه 403: ${html.htmlPath}`,
    };
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

    const reloadCmds = this.resolveReloadCommands();
    let reloadAttempted = false;
    let reloadOk = false;
    if (reloadCmds.length === 0) {
      message +=
        ' — auto-reload خاموش است؛ برای اعمال فوری GITEA_IP_ALLOWLIST_RELOAD_CMD را ست کنید یا GITEA_IP_ALLOWLIST_AUTO_RELOAD=1';
    } else {
      reloadAttempted = true;
      const errors: string[] = [];
      for (const cmd of reloadCmds) {
        const r = this.runShell(cmd);
        if (r.ok) {
          reloadOk = true;
          message += ' — nginx reload OK (تغییرات همین الان اعمال شد)';
          this.logger.log(`Gitea allowlist reload OK via: ${cmd}`);
          break;
        }
        errors.push(`${cmd}: ${r.output || 'exit non-zero'}`);
      }
      if (!reloadOk) {
        const errOut = errors.join(' | ').slice(0, 500);
        this.logger.warn(`Gitea allowlist reload failed: ${errOut}`);
        message += ` — reload ناموفق (فایل نوشته شد ولی nginx هنوز قدیمی است): ${errOut}`;
        message +=
          ' — روی سرور برای کاربر API دسترسی passwordless به nginx reload بدهید، یا GITEA_IP_ALLOWLIST_RELOAD_CMD را ست کنید';
      }
    }

    return { filePath, written, reloadAttempted, reloadOk, message };
  }
}
