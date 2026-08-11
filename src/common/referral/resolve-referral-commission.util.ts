import { Prisma } from '@prisma/client';
import { SETTING_KEYS } from '../../modules/admin/services/admin-settings.service';

type CommissionLookupClient = {
  user: Prisma.UserDelegate;
  systemSetting: Prisma.SystemSettingDelegate;
};

/**
 * Effective referral commission for a referrer:
 * user.referralCommissionPercent if set, else global REFERRAL_COMMISSION_PERCENT.
 */
export async function resolveReferralCommissionPercent(
  client: CommissionLookupClient,
  referrerId: string,
): Promise<number> {
  const user = await client.user.findUnique({
    where: { id: referrerId },
    select: { referralCommissionPercent: true },
  });

  if (user?.referralCommissionPercent != null) {
    const override = Number(user.referralCommissionPercent);
    if (Number.isFinite(override) && override >= 0) {
      return Math.min(100, override);
    }
  }

  const row = await client.systemSetting.findUnique({
    where: { key: SETTING_KEYS.REFERRAL_COMMISSION_PERCENT },
    select: { value: true },
  });
  const global = Number(String(row?.value ?? '').trim());
  if (!Number.isFinite(global) || global <= 0) return 0;
  return Math.min(100, Math.max(0, global));
}
