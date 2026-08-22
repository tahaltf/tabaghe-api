import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { AppSettingsService } from '../../shared/settings/app-settings.service';
import {
  KycFormConfig,
  ZOHAL_SETTING_DEFAULTS,
  ZOHAL_SETTING_KEYS,
  type ZohalFailureService,
} from './zohal-settings.constants';

const CACHE_TTL_MS = 30_000;

type ZohalSettingsSnapshot = {
  identityEnabled: boolean;
  postalEnabled: boolean;
  cardMatchEnabled: boolean;
  ibanMatchEnabled: boolean;
  identityMaxFailures: number;
  cardMatchMaxFailures: number;
  identityFailureCount: number;
  cardMatchFailureCount: number;
  tokenConfigured: boolean;
};

@Injectable()
export class ZohalSettingsService {
  private cache: { at: number; data: ZohalSettingsSnapshot } | null = null;

  constructor(
    private readonly prisma: PrismaService,
    private readonly appSettings: AppSettingsService,
  ) {}

  invalidateCache(): void {
    this.cache = null;
  }

  async getKycFormConfig(): Promise<KycFormConfig> {
    const snap = await this.loadSnapshot();
    const identityActive = this.isIdentityActiveFromSnapshot(snap);
    return {
      mode: identityActive ? 'auto' : 'manual',
      identityActive,
      failureCount: snap.identityFailureCount,
      maxFailures: snap.identityMaxFailures,
    };
  }

  async isIdentityActive(): Promise<boolean> {
    const snap = await this.loadSnapshot();
    return this.isIdentityActiveFromSnapshot(snap);
  }

  async isPostalActive(): Promise<boolean> {
    const snap = await this.loadSnapshot();
    return (
      snap.tokenConfigured &&
      snap.postalEnabled &&
      true
    );
  }

  async isCardMatchActive(): Promise<boolean> {
    const snap = await this.loadSnapshot();
    return (
      snap.tokenConfigured &&
      snap.cardMatchEnabled &&
      snap.cardMatchFailureCount < snap.cardMatchMaxFailures
    );
  }

  async isIbanMatchActive(): Promise<boolean> {
    const snap = await this.loadSnapshot();
    return snap.tokenConfigured && snap.ibanMatchEnabled;
  }

  async recordIdentityFailure(): Promise<{ count: number; circuitOpen: boolean }> {
    const count = await this.incrementCounter(
      ZOHAL_SETTING_KEYS.IDENTITY_FAILURE_COUNT,
    );
    const snap = await this.loadSnapshot(true);
    return {
      count,
      circuitOpen: count >= snap.identityMaxFailures,
    };
  }

  async recordCardMatchFailure(): Promise<{ count: number; circuitOpen: boolean }> {
    const count = await this.incrementCounter(
      ZOHAL_SETTING_KEYS.CARD_MATCH_FAILURE_COUNT,
    );
    const snap = await this.loadSnapshot(true);
    return {
      count,
      circuitOpen: count >= snap.cardMatchMaxFailures,
    };
  }

  async resetFailureCount(service: ZohalFailureService): Promise<void> {
    const key =
      service === 'identity'
        ? ZOHAL_SETTING_KEYS.IDENTITY_FAILURE_COUNT
        : ZOHAL_SETTING_KEYS.CARD_MATCH_FAILURE_COUNT;
    await this.prisma.systemSetting.upsert({
      where: { key },
      create: {
        key,
        value: '0',
        description: KNOWN_COUNTER_DESCRIPTIONS[key],
      },
      update: { value: '0' },
    });
    this.invalidateCache();
  }

  async getAdminStatus(): Promise<{
    tokenConfigured: boolean;
    identityEnabled: boolean;
    postalEnabled: boolean;
    cardMatchEnabled: boolean;
    identityMaxFailures: number;
    cardMatchMaxFailures: number;
    identityFailureCount: number;
    cardMatchFailureCount: number;
    identityActive: boolean;
    postalActive: boolean;
    cardMatchActive: boolean;
  }> {
    const snap = await this.loadSnapshot();
    return {
      tokenConfigured: snap.tokenConfigured,
      identityEnabled: snap.identityEnabled,
      postalEnabled: snap.postalEnabled,
      cardMatchEnabled: snap.cardMatchEnabled,
      identityMaxFailures: snap.identityMaxFailures,
      cardMatchMaxFailures: snap.cardMatchMaxFailures,
      identityFailureCount: snap.identityFailureCount,
      cardMatchFailureCount: snap.cardMatchFailureCount,
      identityActive: this.isIdentityActiveFromSnapshot(snap),
      postalActive:
        snap.tokenConfigured && snap.postalEnabled,
      cardMatchActive:
        snap.tokenConfigured &&
        snap.cardMatchEnabled &&
        snap.cardMatchFailureCount < snap.cardMatchMaxFailures,
    };
  }

  private isIdentityActiveFromSnapshot(snap: ZohalSettingsSnapshot): boolean {
    return (
      snap.tokenConfigured &&
      snap.identityEnabled &&
      snap.identityFailureCount < snap.identityMaxFailures
    );
  }

  private async loadSnapshot(force = false): Promise<ZohalSettingsSnapshot> {
    const now = Date.now();
    if (!force && this.cache && now - this.cache.at < CACHE_TTL_MS) {
      return this.cache.data;
    }

    const keys = Object.values(ZOHAL_SETTING_KEYS);
    const rows = await this.prisma.systemSetting.findMany({
      where: { key: { in: keys } },
      select: { key: true, value: true },
    });
    const map: Record<string, string> = { ...ZOHAL_SETTING_DEFAULTS };
    for (const row of rows) {
      map[row.key] = row.value;
    }

    const data: ZohalSettingsSnapshot = {
      tokenConfigured: Boolean(this.appSettings.getZohalToken()),
      identityEnabled: parseBool(map[ZOHAL_SETTING_KEYS.IDENTITY_ENABLED], true),
      postalEnabled: parseBool(map[ZOHAL_SETTING_KEYS.POSTAL_ENABLED], true),
      cardMatchEnabled: parseBool(
        map[ZOHAL_SETTING_KEYS.CARD_MATCH_ENABLED],
        true,
      ),
      ibanMatchEnabled: parseBool(
        map[ZOHAL_SETTING_KEYS.IBAN_MATCH_ENABLED],
        true,
      ),
      identityMaxFailures: parsePositiveInt(
        map[ZOHAL_SETTING_KEYS.IDENTITY_MAX_FAILURES],
        50,
      ),
      cardMatchMaxFailures: parsePositiveInt(
        map[ZOHAL_SETTING_KEYS.CARD_MATCH_MAX_FAILURES],
        50,
      ),
      identityFailureCount: parseNonNegativeInt(
        map[ZOHAL_SETTING_KEYS.IDENTITY_FAILURE_COUNT],
      ),
      cardMatchFailureCount: parseNonNegativeInt(
        map[ZOHAL_SETTING_KEYS.CARD_MATCH_FAILURE_COUNT],
      ),
    };

    this.cache = { at: now, data };
    return data;
  }

  private async incrementCounter(key: string): Promise<number> {
    const next = await this.prisma.$transaction(async (tx) => {
      const row = await tx.systemSetting.findUnique({ where: { key } });
      const current = parseNonNegativeInt(row?.value ?? '0');
      const value = String(current + 1);
      await tx.systemSetting.upsert({
        where: { key },
        create: {
          key,
          value,
          description: KNOWN_COUNTER_DESCRIPTIONS[key],
        },
        update: { value },
      });
      return current + 1;
    });
    this.invalidateCache();
    return next;
  }
}

const KNOWN_COUNTER_DESCRIPTIONS: Record<string, string> = {
  [ZOHAL_SETTING_KEYS.IDENTITY_FAILURE_COUNT]:
    'شمارنده خطای سراسری استعلام هویت (runtime)',
  [ZOHAL_SETTING_KEYS.CARD_MATCH_FAILURE_COUNT]:
    'شمارنده خطای سراسری تطبیق کارت بانکی (runtime)',
};

function parseBool(value: string | undefined, fallback: boolean): boolean {
  if (value == null || value === '') return fallback;
  const v = value.trim().toLowerCase();
  if (['false', '0', 'no', 'off'].includes(v)) return false;
  if (['true', '1', 'yes', 'on'].includes(v)) return true;
  return fallback;
}

function parsePositiveInt(value: string | undefined, fallback: number): number {
  const n = Number.parseInt(String(value ?? ''), 10);
  if (!Number.isFinite(n) || n < 1) return fallback;
  return n;
}

function parseNonNegativeInt(value: string | undefined): number {
  const n = Number.parseInt(String(value ?? ''), 10);
  if (!Number.isFinite(n) || n < 0) return 0;
  return n;
}
