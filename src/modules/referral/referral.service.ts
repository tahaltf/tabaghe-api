import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import {
  generateInviteCode,
  normalizeInviteCode,
} from '../../common/referral/invite-code.util';
import { SETTING_KEYS } from '../admin/services/admin-settings.service';

const DEFAULT_SHARE_MESSAGE =
  'سلام! من تو «طبقه» ثبت‌نام کردم و خرید و فروش گوشی و کالای دیجیتال رو راحت‌تر کردم. با کد دعوت من ثبت‌نام کن:\n{inviteCode}\n{inviteLink}';

export type UserReferralInfo = {
  inviteCode: string;
  inviteLink: string;
  commissionPercent: number;
  shareMessage: string;
  referralCount: number;
  totalRewardAmount: number;
  hasReferrer: boolean;
};

@Injectable()
export class ReferralService {
  constructor(private readonly prisma: PrismaService) {}

  async ensureInviteCode(userId: string): Promise<string> {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { inviteCode: true },
    });
    if (!user) throw new NotFoundException('کاربر یافت نشد');
    if (user.inviteCode) return user.inviteCode;

    for (let attempt = 0; attempt < 10; attempt++) {
      const code = generateInviteCode();
      try {
        await this.prisma.user.update({
          where: { id: userId },
          data: { inviteCode: code },
        });
        return code;
      } catch (err) {
        if (
          err instanceof Prisma.PrismaClientKnownRequestError &&
          err.code === 'P2002'
        ) {
          continue;
        }
        throw err;
      }
    }
    throw new BadRequestException('ساخت کد دعوت ناموفق بود؛ دوباره تلاش کنید.');
  }

  async createUniqueInviteCode(
    tx: Prisma.TransactionClient,
  ): Promise<string> {
    for (let attempt = 0; attempt < 12; attempt++) {
      const code = generateInviteCode();
      const exists = await tx.user.findUnique({
        where: { inviteCode: code },
        select: { id: true },
      });
      if (!exists) return code;
    }
    throw new BadRequestException('ساخت کد دعوت ناموفق بود.');
  }

  /**
   * Resolves and validates a referral code for binding to a new user.
   * Returns referrer id or null if code empty.
   */
  async resolveReferrerId(
    tx: Prisma.TransactionClient,
    userId: string,
    referralCodeRaw: string | null | undefined,
    alreadyReferredById: string | null | undefined,
  ): Promise<string | null> {
    const code = normalizeInviteCode(referralCodeRaw);
    if (!code) {
      if (alreadyReferredById) return null;
      return null;
    }

    if (alreadyReferredById) {
      throw new BadRequestException(
        'کد معرف قبلاً برای این حساب ثبت شده و قابل تغییر نیست.',
      );
    }

    const referrer = await tx.user.findUnique({
      where: { inviteCode: code },
      select: { id: true, isActive: true },
    });
    if (!referrer) {
      throw new BadRequestException('کد معرف معتبر نیست.');
    }
    if (!referrer.isActive) {
      throw new BadRequestException('حساب معرف غیرفعال است.');
    }
    if (referrer.id === userId) {
      throw new BadRequestException('نمی‌توانید از کد دعوت خودتان استفاده کنید.');
    }
    return referrer.id;
  }

  async getReferralInfo(userId: string): Promise<UserReferralInfo> {
    const inviteCode = await this.ensureInviteCode(userId);

    const [user, referralCount, rewardAgg, settings] = await Promise.all([
      this.prisma.user.findUnique({
        where: { id: userId },
        select: { referredById: true },
      }),
      this.prisma.user.count({ where: { referredById: userId } }),
      this.prisma.referralReward.aggregate({
        where: { referrerId: userId },
        _sum: { amount: true },
      }),
      this.prisma.systemSetting.findMany({
        where: {
          key: {
            in: [
              SETTING_KEYS.REFERRAL_COMMISSION_PERCENT,
              SETTING_KEYS.REFERRAL_SHARE_MESSAGE,
            ],
          },
        },
        select: { key: true, value: true },
      }),
    ]);

    const byKey = new Map(settings.map((s) => [s.key, s.value]));
    const percentRaw = Number(
      String(byKey.get(SETTING_KEYS.REFERRAL_COMMISSION_PERCENT) ?? '').trim(),
    );
    const commissionPercent =
      Number.isFinite(percentRaw) && percentRaw > 0
        ? Math.min(100, Math.max(0, percentRaw))
        : 0;

    const inviteLink = this.buildInviteLink(inviteCode);
    const template =
      String(byKey.get(SETTING_KEYS.REFERRAL_SHARE_MESSAGE) ?? '').trim() ||
      DEFAULT_SHARE_MESSAGE;
    const shareMessage = template
      .replaceAll('{inviteCode}', inviteCode)
      .replaceAll('{inviteLink}', inviteLink);

    return {
      inviteCode,
      inviteLink,
      commissionPercent,
      shareMessage,
      referralCount,
      totalRewardAmount: Number(rewardAgg._sum.amount?.toString() ?? '0'),
      hasReferrer: !!user?.referredById,
    };
  }

  private buildInviteLink(inviteCode: string): string {
    const base =
      process.env.PUBLIC_APP_URL?.replace(/\/$/, '') ||
      process.env.FRONTEND_URL?.replace(/\/$/, '') ||
      'https://tabagheh.com';
    return `${base}/auth?ref=${encodeURIComponent(inviteCode)}`;
  }
}
