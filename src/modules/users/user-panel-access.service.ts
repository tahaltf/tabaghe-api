import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma, UserStatus } from '@prisma/client';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import {
  defaultPanelAccessMap,
  isUserPanelAccessKey,
  USER_PANEL_ACCESS_KEYS,
  UserPanelAccessKey,
  UserPanelAccessMap,
} from './config/user-panel-access.registry';

type PanelAccessCarrier = {
  panelAccess?: Prisma.JsonValue | null;
};

type PanelAccessUserShape = {
  status: UserStatus;
  isVerified: boolean;
  shabaNumber: string | null;
};

/**
 * Stores the full resolved boolean map in DB for clarity (every known key present).
 * Missing keys and null still resolve to enabled (true) when reading legacy rows.
 */
@Injectable()
export class UserPanelAccessService {
  constructor(private readonly prisma: PrismaService) {}

  resolveMap(raw: Prisma.JsonValue | null | undefined): UserPanelAccessMap {
    const resolved = defaultPanelAccessMap();
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
      return resolved;
    }

    const stored = raw as Record<string, unknown>;
    for (const key of USER_PANEL_ACCESS_KEYS) {
      const value = stored[key];
      if (value === false) resolved[key] = false;
      else if (value === true) resolved[key] = true;
    }
    return resolved;
  }

  private applyKycRestrictions(
    base: UserPanelAccessMap,
    user: PanelAccessUserShape,
    settings: Record<string, string>,
  ): UserPanelAccessMap {
    const map = { ...base };
    const identityVerified =
      user.status === UserStatus.APPROVED && user.isVerified === true;
    const normalizedShaba = String(user.shabaNumber ?? '')
      .trim()
      .replace(/^IR/i, '');
    const financialVerified = identityVerified && normalizedShaba.length === 24;

    const requireIdentityForOrders =
      String(settings.KYC_REQUIRE_IDENTITY_FOR_ORDERS ?? 'true').toLowerCase() !==
      'false';
    const requireFinancialForWallet =
      String(settings.KYC_REQUIRE_FINANCIAL_FOR_WALLET ?? 'true').toLowerCase() !==
      'false';
    const requireFinancialForWithdraw =
      String(settings.KYC_REQUIRE_FINANCIAL_FOR_WITHDRAW ?? 'true').toLowerCase() !==
      'false';

    if (requireIdentityForOrders && !identityVerified) {
      map['dashboard.orders'] = false;
    }

    if (requireFinancialForWallet && !financialVerified) {
      map['dashboard.wallet'] = false;
    }

    if (requireFinancialForWithdraw && !financialVerified) {
      map['dashboard.wallet.withdraw'] = false;
    }

    return map;
  }

  private async loadKycRestrictionSettings(): Promise<Record<string, string>> {
    const keys = [
      'KYC_REQUIRE_IDENTITY_FOR_ORDERS',
      'KYC_REQUIRE_FINANCIAL_FOR_WALLET',
      'KYC_REQUIRE_FINANCIAL_FOR_WITHDRAW',
    ];
    const rows = await this.prisma.systemSetting.findMany({
      where: { key: { in: keys } },
      select: { key: true, value: true },
    });
    const result: Record<string, string> = {};
    for (const row of rows) result[row.key] = row.value;
    return result;
  }

  isAllowed(
    rawOrUser: Prisma.JsonValue | null | undefined | PanelAccessCarrier,
    key: UserPanelAccessKey,
  ): boolean {
    const raw =
      rawOrUser &&
      typeof rawOrUser === 'object' &&
      !Array.isArray(rawOrUser) &&
      'panelAccess' in rawOrUser
        ? rawOrUser.panelAccess
        : rawOrUser;
    return this.resolveMap(raw)[key];
  }

  validatePatch(body: Record<string, unknown>): Partial<UserPanelAccessMap> {
    const patch: Partial<UserPanelAccessMap> = {};
    for (const [key, value] of Object.entries(body)) {
      if (!isUserPanelAccessKey(key)) {
        throw new BadRequestException(`کلید دسترسی نامعتبر: ${key}`);
      }
      if (typeof value !== 'boolean') {
        throw new BadRequestException(
          `مقدار دسترسی «${key}» باید true یا false باشد`,
        );
      }
      patch[key] = value;
    }
    return patch;
  }

  async getResolvedForUser(userId: string): Promise<UserPanelAccessMap> {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { panelAccess: true, status: true, isVerified: true, shabaNumber: true },
    });
    if (!user) throw new NotFoundException('کاربر یافت نشد');
    const [settings, resolved] = await Promise.all([
      this.loadKycRestrictionSettings(),
      Promise.resolve(this.resolveMap(user.panelAccess)),
    ]);
    return this.applyKycRestrictions(resolved, user, settings);
  }

  async updateForUser(
    userId: string,
    patch: Record<string, unknown>,
  ): Promise<UserPanelAccessMap> {
    const validatedPatch = this.validatePatch(patch);
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { panelAccess: true },
    });
    if (!user) throw new NotFoundException('کاربر یافت نشد');

    const next = {
      ...this.resolveMap(user.panelAccess),
      ...validatedPatch,
    };

    await this.prisma.user.update({
      where: { id: userId },
      data: { panelAccess: next as Prisma.InputJsonValue },
    });

    return next;
  }
}
