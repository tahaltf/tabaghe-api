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
import { resolveReferralCommissionPercent } from '../../common/referral/resolve-referral-commission.util';
import { SETTING_KEYS } from '../admin/services/admin-settings.service';

const DEFAULT_SHARE_MESSAGE =
  'سلام!\n' +
  'من تو «طبقه» خرید و فروش گوشی و کالای دیجیتال رو شروع کردم — امن، راحت و با کارمزد شفاف.\n\n' +
  'با کد دعوت من ثبت‌نام کن تا وارد شی:\n' +
  'کد: {inviteCode}\n' +
  '{inviteLink}\n\n' +
  'منتظرتم!';

/** حداکثر تعداد دوستان و پاداش‌هایی که در صفحه دعوت برگردانده می‌شود */
const FRIENDS_LIMIT = 30;
const RECENT_REWARDS_LIMIT = 8;
const RECENT_WINDOW_DAYS = 30;
/** درصد کارمزد پیش‌فرض برای ماشین‌حساب تخمینی، وقتی دسته‌بندی فعالی وجود ندارد */
const FALLBACK_FEE_PERCENT = 5;

export type ReferralFriendStatus = 'EARNING' | 'VERIFIED' | 'JOINED';

export type ReferralFriend = {
  id: string;
  /** نام نمایشی ماسک‌شده (نام + حرف اول فامیل) */
  name: string;
  /** شماره ماسک‌شده مثل 0912***6789 */
  maskedPhone: string;
  joinedAt: string;
  status: ReferralFriendStatus;
  /** تعداد فروش‌های تکمیل‌شده‌ای که پاداش تولید کرده */
  salesCount: number;
  /** جمع پاداش دریافتی از این دوست (تومان) */
  earned: number;
};

export type ReferralRewardItem = {
  id: string;
  amount: number;
  createdAt: string;
  friendName: string;
};

export type UserReferralInfo = {
  inviteCode: string;
  inviteLink: string;
  commissionPercent: number;
  shareMessage: string;
  referralCount: number;
  /** دوستانی که حداقل یک فروش پاداش‌دار داشته‌اند */
  activeReferralCount: number;
  totalRewardAmount: number;
  /** جمع پاداش در بازه recentWindowDays روز اخیر */
  recentRewardAmount: number;
  recentWindowDays: number;
  /** میانگین درصد کارمزد پلتفرم — فقط برای تخمین در ماشین‌حساب */
  estimatedFeePercent: number;
  friends: ReferralFriend[];
  friendsTruncated: boolean;
  recentRewards: ReferralRewardItem[];
  hasReferrer: boolean;
  referrerName: string | null;
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

  /**
   * Soft-bind referral from invite link during login/registration.
   * NEVER throws — any referral problem is ignored so auth can continue.
   * Returns true when referredById was newly set.
   */
  async tryBindReferralCode(
    userId: string,
    referralCodeRaw: string | null | undefined,
  ): Promise<boolean> {
    const code = normalizeInviteCode(referralCodeRaw);
    if (!code) return false;

    try {
      return await this.prisma.$transaction(async (tx) => {
        const current = await tx.user.findUnique({
          where: { id: userId },
          select: { referredById: true },
        });
        if (!current || current.referredById) return false;

        const referredById = await this.resolveReferrerId(
          tx,
          userId,
          code,
          current.referredById,
        );
        if (!referredById) return false;

        await tx.user.update({
          where: { id: userId },
          data: { referredById },
        });
        return true;
      });
    } catch {
      // کد نامعتبر، معرف غیرفعال، خودمعرفی، خطای DB، … — ورود/ثبت‌نام قطع نمی‌شود
      return false;
    }
  }

  async getReferralInfo(userId: string): Promise<UserReferralInfo> {
    const inviteCode = await this.ensureInviteCode(userId);
    const recentSince = new Date(
      Date.now() - RECENT_WINDOW_DAYS * 24 * 60 * 60 * 1000,
    );

    const [
      user,
      referralCount,
      rewardAgg,
      recentRewardAgg,
      settings,
      friendRows,
      rewardsByFriend,
      recentRewardRows,
      feePercent,
    ] = await Promise.all([
      this.prisma.user.findUnique({
        where: { id: userId },
        select: {
          referredById: true,
          referredBy: {
            select: { firstName: true, lastName: true, displayName: true },
          },
        },
      }),
      this.prisma.user.count({ where: { referredById: userId } }),
      this.prisma.referralReward.aggregate({
        where: { referrerId: userId },
        _sum: { amount: true },
      }),
      this.prisma.referralReward.aggregate({
        where: { referrerId: userId, createdAt: { gte: recentSince } },
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
      this.prisma.user.findMany({
        where: { referredById: userId },
        select: {
          id: true,
          firstName: true,
          lastName: true,
          displayName: true,
          phone: true,
          status: true,
          isVerified: true,
          createdAt: true,
        },
        orderBy: { createdAt: 'desc' },
        take: FRIENDS_LIMIT,
      }),
      this.prisma.referralReward.groupBy({
        by: ['sellerId'],
        where: { referrerId: userId },
        _sum: { amount: true },
        _count: { _all: true },
      }),
      this.prisma.referralReward.findMany({
        where: { referrerId: userId },
        select: { id: true, amount: true, createdAt: true, sellerId: true },
        orderBy: { createdAt: 'desc' },
        take: RECENT_REWARDS_LIMIT,
      }),
      this.readEstimatedFeePercent(),
    ]);

    const byKey = new Map(settings.map((s) => [s.key, s.value]));
    const commissionPercent = await resolveReferralCommissionPercent(
      this.prisma,
      userId,
    );

    const inviteLink = this.buildInviteLink(inviteCode);
    const template =
      String(byKey.get(SETTING_KEYS.REFERRAL_SHARE_MESSAGE) ?? '').trim() ||
      DEFAULT_SHARE_MESSAGE;
    const shareMessage = template
      .replaceAll('{inviteCode}', inviteCode)
      .replaceAll('{inviteLink}', inviteLink);

    const statsBySeller = new Map(
      rewardsByFriend.map((row) => [
        row.sellerId,
        {
          earned: Number(row._sum.amount?.toString() ?? '0'),
          salesCount: row._count._all,
        },
      ]),
    );

    const friends: ReferralFriend[] = friendRows.map((row) => {
      const stats = statsBySeller.get(row.id);
      const isApproved = row.status === 'APPROVED' || row.isVerified;
      return {
        id: row.id,
        name: this.maskName(row),
        maskedPhone: this.maskPhone(row.phone),
        joinedAt: row.createdAt.toISOString(),
        status: stats ? 'EARNING' : isApproved ? 'VERIFIED' : 'JOINED',
        salesCount: stats?.salesCount ?? 0,
        earned: stats?.earned ?? 0,
      };
    });

    const nameById = new Map(friends.map((f) => [f.id, f.name]));

    return {
      inviteCode,
      inviteLink,
      commissionPercent,
      shareMessage,
      referralCount,
      activeReferralCount: statsBySeller.size,
      totalRewardAmount: Number(rewardAgg._sum.amount?.toString() ?? '0'),
      recentRewardAmount: Number(
        recentRewardAgg._sum.amount?.toString() ?? '0',
      ),
      recentWindowDays: RECENT_WINDOW_DAYS,
      estimatedFeePercent: feePercent,
      friends,
      friendsTruncated: referralCount > friends.length,
      recentRewards: recentRewardRows.map((row) => ({
        id: row.id,
        amount: Number(row.amount.toString()),
        createdAt: row.createdAt.toISOString(),
        friendName: nameById.get(row.sellerId) ?? 'کاربر طبقه',
      })),
      hasReferrer: !!user?.referredById,
      referrerName: user?.referredBy ? this.maskName(user.referredBy) : null,
    };
  }

  /**
   * میانگین درصد کارمزد فروش کالای کارکرده در دسته‌بندی‌های فعال.
   * فقط برای نمایش تخمینی در ماشین‌حساب صفحه دعوت استفاده می‌شود.
   */
  private async readEstimatedFeePercent(): Promise<number> {
    try {
      const categories = await this.prisma.category.findMany({
        where: { isActive: true },
        select: {
          feePercentageDirectUsed: true,
          feePercentageDirect: true,
          feePercentage: true,
        },
      });
      const values = categories
        .map(
          (c) =>
            c.feePercentageDirectUsed ??
            c.feePercentageDirect ??
            c.feePercentage,
        )
        .filter((v): v is number => typeof v === 'number' && v > 0);
      if (!values.length) return FALLBACK_FEE_PERCENT;
      const avg = values.reduce((sum, v) => sum + v, 0) / values.length;
      return Math.round(avg * 10) / 10;
    } catch {
      return FALLBACK_FEE_PERCENT;
    }
  }

  /** نام نمایشی حریم‌خصوصی‌محور: نام کوچک + حرف اول نام خانوادگی */
  private maskName(user: {
    firstName?: string | null;
    lastName?: string | null;
    displayName?: string | null;
  }): string {
    const first = (user.firstName ?? '').trim();
    const last = (user.lastName ?? '').trim();
    if (first) return last ? `${first} ${last.charAt(0)}.` : first;
    const display = (user.displayName ?? '').trim();
    if (display) return display;
    return 'کاربر طبقه';
  }

  /** 09123456789 → 0912***6789 */
  private maskPhone(phone: string | null | undefined): string {
    const digits = String(phone ?? '').replace(/\D/g, '');
    if (digits.length < 8) return '';
    return `${digits.slice(0, 4)}***${digits.slice(-4)}`;
  }

  private buildInviteLink(inviteCode: string): string {
    const base =
      process.env.PUBLIC_APP_URL?.replace(/\/$/, '') ||
      process.env.FRONTEND_URL?.replace(/\/$/, '') ||
      'https://tabagheh.com';
    return `${base}/auth?ref=${encodeURIComponent(inviteCode)}`;
  }
}
