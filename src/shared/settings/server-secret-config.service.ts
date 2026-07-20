import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import {
  ADMIN_SECRET_KEYS_REGISTRY,
  BLOCKED_SECRET_ENV_KEYS,
  getAdminSecretKeyDef,
  isRegisteredAdminSecretKey,
} from '../../modules/admin/config/admin-secret-keys.registry';
import { AdminSecretsCryptoService } from './admin-secrets-crypto.service';

export type ServerSecretSource = 'db' | 'env' | 'none';

@Injectable()
export class ServerSecretConfigService implements OnModuleInit {
  private readonly logger = new Logger(ServerSecretConfigService.name);
  private readonly cache = new Map<string, string>();
  private cacheReady = false;

  constructor(
    private readonly prisma: PrismaService,
    private readonly crypto: AdminSecretsCryptoService,
    private readonly config: ConfigService,
  ) {}

  async onModuleInit(): Promise<void> {
    await this.reloadCache();
    this.warnUnregisteredSensitiveEnvKeys();
  }

  async reloadCache(): Promise<void> {
    this.cache.clear();
    if (!this.crypto.isReady()) {
      this.cacheReady = true;
      return;
    }

    const rows = await this.prisma.systemSecret.findMany({
      select: { key: true, encryptedValue: true },
    });

    for (const row of rows) {
      if (!isRegisteredAdminSecretKey(row.key)) {
        this.logger.warn(
          `Ignoring unregistered secret key in DB: ${row.key}`,
        );
        continue;
      }
      try {
        this.cache.set(row.key, this.crypto.decrypt(row.encryptedValue));
      } catch (err) {
        this.logger.error(
          `Failed to decrypt secret "${row.key}": ${(err as Error).message}`,
        );
      }
    }

    this.cacheReady = true;
  }

  /** خواندن sync — ابتدا DB cache، سپس env (در صورت مجاز بودن) */
  get(key: string): string {
    const def = getAdminSecretKeyDef(key);
    if (def) {
      const cached = this.cache.get(key);
      if (cached !== undefined && cached !== '') {
        return cached;
      }
      if (def.envFallback !== false) {
        return this.readEnv(key);
      }
      return '';
    }

    if (this.cache.has(key)) {
      return this.cache.get(key) ?? '';
    }
    return this.readEnv(key);
  }

  getOptional(key: string): string | undefined {
    const value = this.get(key).trim();
    return value || undefined;
  }

  resolveSource(key: string): ServerSecretSource {
    const def = getAdminSecretKeyDef(key);
    const cached = this.cache.get(key);
    if (cached !== undefined && cached !== '') {
      return 'db';
    }
    if (def?.envFallback === false) {
      return 'none';
    }
    return this.readEnv(key) ? 'env' : 'none';
  }

  hasConfiguredValue(key: string): boolean {
    return this.resolveSource(key) !== 'none';
  }

  isCacheReady(): boolean {
    return this.cacheReady;
  }

  private readEnv(key: string): string {
    return (
      this.config.get<string>(key)?.trim() ??
      process.env[key]?.trim() ??
      ''
    );
  }

  private warnUnregisteredSensitiveEnvKeys(): void {
    for (const envKey of Object.keys(process.env)) {
      if (!envKey || BLOCKED_SECRET_ENV_KEYS.has(envKey)) continue;
      if (isRegisteredAdminSecretKey(envKey)) continue;

      const value = process.env[envKey]?.trim();
      if (!value) continue;

      const upper = envKey.toUpperCase();
      const looksSensitive =
        upper.includes('SECRET') ||
        upper.includes('API_KEY') ||
        upper.includes('TOKEN') ||
        upper.includes('PASSWORD') ||
        upper.includes('_KEY');

      if (looksSensitive) {
        this.logger.warn(
          `Env key "${envKey}" looks sensitive but is not in admin secret registry — consider adding it`,
        );
      }
    }
  }

  /** برای سازگاری با utilهایی که map env می‌خواهند */
  buildEnvMap(keys: string[] = ADMIN_SECRET_KEYS_REGISTRY.map((d) => d.key)): Record<string, string> {
    const out: Record<string, string> = {};
    for (const key of keys) {
      out[key] = this.get(key);
    }
    return out;
  }
}
