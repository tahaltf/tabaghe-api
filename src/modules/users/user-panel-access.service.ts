import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma, UserStatus } from '@prisma/client';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import {
  isUserPanelAccessKey,
  resolveUserPanelAccessMap,
  UserPanelAccessKey,
  UserPanelAccessMap,
} from './config/user-panel-access.registry';
import {
  isFinancialVerified,
  isIdentityVerified,
} from '../../common/kyc/kyc-profile.util';

type PanelAccessCarrier = {
  panelAccess?: Prisma.JsonValue | null;
};

type PanelAccessUserShape = {
  status: UserStatus;
  isVerified: boolean;
  shabaNumber: string | null;
  nationalCardImage: string | null;
};

/**
 * Stores the full resolved boolean map in DB for clarity (every known key present).
 * Missing keys resolve to enabled (true), except `dashboard.contentStudio`
 * whose default follows global AI_ENABLED (so global-off + per-user-on works).
 */
@Injectable()
export class UserPanelAccessService {
  constructor(private readonly prisma: PrismaService) {}

  resolveMap(
    raw: Prisma.JsonValue | null | undefined,
    options?: { aiContentDefault?: boolean },
  ): UserPanelAccessMap {
    return resolveUserPanelAccessMap(raw, options);
  }

  private applyKycRestrictions(
    base: UserPanelAccessMap,
    user: PanelAccessUserShape,
    settings: Record<string, string>,
  ): UserPanelAccessMap {
    const map = { ...base };
    const identityOk = isIdentityVerified(user);
    const financialOk = isFinancialVerified(user);

    const requireIdentityForOrders =
      String(settings.KYC_REQUIRE_IDENTITY_FOR_ORDERS ?? 'true').toLowerCase() !==
      'false';
    const requireFinancialForWallet =
      String(settings.KYC_REQUIRE_FINANCIAL_FOR_WALLET ?? 'true').toLowerCase() !==
      'false';
    const requireFinancialForWithdraw =
      String(settings.KYC_REQUIRE_FINANCIAL_FOR_WITHDRAW ?? 'true').toLowerCase() !==
      'false';

    if (requireIdentityForOrders && !identityOk) {
      map['dashboard.orders'] = false;
    }

    if (requireFinancialForWallet && !financialOk) {
      map['dashboard.wallet'] = false;
    }

    if (requireFinancialForWithdraw && !financialOk) {
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

  private async isAiContentGloballyEnabled(): Promise<boolean> {
    const row = await this.prisma.systemSetting.findUnique({
      where: { key: 'AI_ENABLED' },
    });
    const raw = (row?.value ?? 'false').trim().toLowerCase();
    return ['1', 'true', 'yes', 'on'].includes(raw);
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
        // ignore unknown nested leftovers; only accept registry keys
        continue;
      }
      if (typeof value !== 'boolean') {
        throw new BadRequestException(
          `مقدار دسترسی «${key}» باید true یا false باشد`,
        );
      }
      patch[key] = value;
    }
    if (!Object.keys(patch).length) {
      throw new BadRequestException('هیچ دسترسی معتبری ارسال نشده است');
    }
    return patch;
  }

  async getResolvedForUser(userId: string): Promise<UserPanelAccessMap> {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: {
        panelAccess: true,
        status: true,
        isVerified: true,
        shabaNumber: true,
        nationalCardImage: true,
      },
    });
    if (!user) throw new NotFoundException('کاربر یافت نشد');
    const [settings, aiEnabled] = await Promise.all([
      this.loadKycRestrictionSettings(),
      this.isAiContentGloballyEnabled(),
    ]);
    const resolved = this.resolveMap(user.panelAccess, {
      aiContentDefault: aiEnabled,
    });
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

    const aiEnabled = await this.isAiContentGloballyEnabled();
    const next = {
      ...this.resolveMap(user.panelAccess, { aiContentDefault: aiEnabled }),
      ...validatedPatch,
    };

    await this.prisma.user.update({
      where: { id: userId },
      data: { panelAccess: next as Prisma.InputJsonValue },
    });

    return this.getResolvedForUser(userId);
  }
}
