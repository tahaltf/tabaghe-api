import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { UserRole } from '@prisma/client';
import { PrismaService } from '../../../infrastructure/prisma/prisma.service';
import { appendJsonLog } from '../../../common/logging/app-log.util';
import { AuthenticatedUser } from '../../../shared/contracts/auth';
import { AdminSecretsCryptoService } from '../../../shared/settings/admin-secrets-crypto.service';
import { ServerSecretConfigService } from '../../../shared/settings/server-secret-config.service';
import {
  AdminSecretKeyDef,
  assertAdminSecretKey,
  getAdminSecretKeyDef,
  groupAdminSecretCatalog,
  maskAdminSecretValue,
  validateAdminSecretValue,
} from '../config/admin-secret-keys.registry';

export type AdminSecretItemSource = 'db' | 'env' | 'none';

export interface AdminSecretCatalogItem extends AdminSecretKeyDef {
  isConfigured: boolean;
  maskedValue: string;
  /** فقط برای GODADMIN — مقدار کامل خوانا */
  value: string | null;
  source: AdminSecretItemSource;
  updatedAt: string | null;
  updatedById: string | null;
}

@Injectable()
export class AdminSecretKeysService {
  private readonly revealAttempts = new Map<string, number[]>();
  private static readonly REVEAL_RATE_LIMIT = 10;
  private static readonly REVEAL_WINDOW_MS = 60_000;

  constructor(
    private readonly prisma: PrismaService,
    private readonly crypto: AdminSecretsCryptoService,
    private readonly resolver: ServerSecretConfigService,
  ) {}

  getCatalog() {
    return {
      groups: groupAdminSecretCatalog(),
      totalKeys: groupAdminSecretCatalog().reduce(
        (sum, g) => sum + g.keys.length,
        0,
      ),
    };
  }

  async list(actor?: AuthenticatedUser): Promise<AdminSecretCatalogItem[]> {
    const revealPlain = actor?.role === UserRole.GODADMIN;
    const rows = await this.prisma.systemSecret.findMany({
      select: {
        key: true,
        updatedAt: true,
        updatedById: true,
      },
    });
    const rowByKey = new Map(rows.map((r) => [r.key, r]));

    return groupAdminSecretCatalog()
      .flatMap((g) => g.keys)
      .map((def) =>
        this.toCatalogItem(def, rowByKey.get(def.key), revealPlain),
      );
  }

  async set(key: string, value: string, actor: AuthenticatedUser) {
    const def = this.requireRegisteredKey(key);
    const trimmed = value.trim();
    const validationError = validateAdminSecretValue(def, trimmed);
    if (validationError) {
      throw new BadRequestException(validationError);
    }
    if (!this.crypto.isReady()) {
      throw new ServiceUnavailableException(
        'ADMIN_SECRETS_ENC_KEY روی سرور تنظیم نشده است',
      );
    }

    const encryptedValue = this.crypto.encrypt(trimmed);
    const previous = await this.prisma.systemSecret.findUnique({
      where: { key },
    });

    await this.prisma.systemSecret.upsert({
      where: { key },
      create: {
        key,
        encryptedValue,
        updatedById: actor.id,
      },
      update: {
        encryptedValue,
        updatedById: actor.id,
      },
    });

    await this.resolver.reloadCache();
    this.logSecretAudit(actor, key, previous ? 'update' : 'set');

    const row = await this.prisma.systemSecret.findUnique({
      where: { key },
      select: { updatedAt: true, updatedById: true },
    });
    return this.toCatalogItem(
      def,
      row ?? undefined,
      actor.role === UserRole.GODADMIN,
    );
  }

  async clear(key: string, actor: AuthenticatedUser) {
    this.requireRegisteredKey(key);
    const existing = await this.prisma.systemSecret.findUnique({
      where: { key },
    });
    if (!existing) {
      throw new NotFoundException('این کلید در پایگاه داده ذخیره نشده است');
    }

    await this.prisma.systemSecret.delete({ where: { key } });
    await this.resolver.reloadCache();
    this.logSecretAudit(actor, key, 'clear');

    const def = assertAdminSecretKey(key);
    return this.toCatalogItem(def, undefined, actor.role === UserRole.GODADMIN);
  }

  async reveal(key: string, actor: AuthenticatedUser): Promise<{ key: string; value: string }> {
    if (actor.role !== UserRole.GODADMIN) {
      throw new ForbiddenException(
        'فقط گاد ادمین می‌تواند مقدار کامل کلید را مشاهده کند',
      );
    }
    this.enforceRevealRateLimit(actor.id);

    const def = this.requireRegisteredKey(key);
    const row = await this.prisma.systemSecret.findUnique({ where: { key } });
    let value = '';

    if (row) {
      if (!this.crypto.isReady()) {
        throw new ServiceUnavailableException(
          'ADMIN_SECRETS_ENC_KEY روی سرور تنظیم نشده است',
        );
      }
      value = this.crypto.decrypt(row.encryptedValue);
    } else if (def.envFallback !== false) {
      value = this.resolver.get(key);
    }

    if (!value.trim()) {
      throw new NotFoundException('مقداری برای این کلید یافت نشد');
    }

    this.logSecretAudit(actor, key, 'reveal');
    return { key, value };
  }

  private toCatalogItem(
    def: AdminSecretKeyDef,
    row?: { updatedAt: Date; updatedById: string | null },
    revealPlain = false,
  ): AdminSecretCatalogItem {
    const source = this.resolver.resolveSource(def.key);
    const rawValue = source === 'none' ? '' : this.resolver.get(def.key);
    return {
      ...def,
      isConfigured: source !== 'none',
      maskedValue: rawValue
        ? maskAdminSecretValue(rawValue, def.kind)
        : '',
      value: revealPlain && rawValue ? rawValue : null,
      source,
      updatedAt: row?.updatedAt?.toISOString() ?? null,
      updatedById: row?.updatedById ?? null,
    };
  }

  private requireRegisteredKey(key: string): AdminSecretKeyDef {
    const def = getAdminSecretKeyDef(key);
    if (!def) {
      throw new BadRequestException('این کلید در registry مجاز نیست');
    }
    return def;
  }

  private enforceRevealRateLimit(actorId: string): void {
    const now = Date.now();
    const attempts = (this.revealAttempts.get(actorId) ?? []).filter(
      (ts) => now - ts < AdminSecretKeysService.REVEAL_WINDOW_MS,
    );
    if (attempts.length >= AdminSecretKeysService.REVEAL_RATE_LIMIT) {
      throw new ForbiddenException(
        'تعداد درخواست reveal بیش از حد مجاز است. کمی بعد دوباره تلاش کنید.',
      );
    }
    attempts.push(now);
    this.revealAttempts.set(actorId, attempts);
  }

  private logSecretAudit(
    actor: AuthenticatedUser,
    key: string,
    action: 'set' | 'update' | 'clear' | 'reveal',
  ): void {
    appendJsonLog('secrets-audit.log', {
      at: new Date().toISOString(),
      actorId: actor.id,
      actorRole: actor.role,
      key,
      action,
    });
  }
}
