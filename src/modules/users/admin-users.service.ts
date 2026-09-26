import { Injectable } from '@nestjs/common';
import { NotificationType, Prisma, UserStatus } from '@prisma/client';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { NotificationService } from '../notification/notification.service';
import { PlanLifecycleService } from '../plans/plan-lifecycle.service';
import { AiTokenService } from '../ai-content/services/ai-token.service';
import { AiContentSettingsService } from '../ai-content/services/ai-content-settings.service';

const KYC_REQUEST_SELECT = {
  id: true,
  firstName: true,
  lastName: true,
  phone: true,
  nationalCode: true,
  shabaNumber: true,
  nationalCardImage: true,
  createdAt: true,
  updatedAt: true,
} satisfies Prisma.UserSelect;

export type KycRequest = Prisma.UserGetPayload<{
  select: typeof KYC_REQUEST_SELECT;
}>;

@Injectable()
export class AdminUsersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly notificationService: NotificationService,
    private readonly planLifecycle: PlanLifecycleService,
    private readonly aiTokens: AiTokenService,
    private readonly aiSettings: AiContentSettingsService,
  ) {}

  listPendingKyc(): Promise<KycRequest[]> {
    return this.prisma.user.findMany({
      where: { status: UserStatus.PENDING },
      select: KYC_REQUEST_SELECT,
      orderBy: { updatedAt: 'asc' },
    });
  }

  async approve(
    targetUserId: string,
    options?: { source?: 'admin' | 'zohal' },
  ): Promise<{ id: string; status: UserStatus; isVerified: boolean }> {
    const updatedUser = await this.prisma.user.update({
      where: { id: targetUserId },
      data: {
        status: UserStatus.APPROVED,
        isVerified: true,
        kycRejectionReason: null,
        kycReviewedAt: new Date(),
      },
      select: { id: true, status: true, isVerified: true },
    });

    await this.notificationService.create({
      userId: targetUserId,
      type: NotificationType.KYC_APPROVED,
      title: 'احراز هویت تایید شد',
      message:
        options?.source === 'zohal'
          ? 'هویت شما از طریق استعلام شاهکار و ثبت احوال تایید شد و حساب کاربری شما فعال است.'
          : 'مدارک هویتی شما توسط ادمین تایید شد و اکنون حساب کاربری شما فعال است.',
    });

    void this.planLifecycle.assignKycGiftPlan(targetUserId);

    void this.grantKycAiTokens(targetUserId);

    return updatedUser;
  }

  private async grantKycAiTokens(userId: string): Promise<void> {
    // وقتی تولید محتوا در سطح سایت خاموش است، نه توکن بده و نه پیام بفرست.
    if (!(await this.aiSettings.isEnabled())) return;

    const amount = await this.aiSettings.getKycWelcomeTokens();
    if (amount <= 0) return;

    const granted = await this.aiTokens.grantKycWelcome(userId, amount);
    if (!granted) return;

    await this.notificationService.create({
      userId,
      type: NotificationType.SYSTEM,
      title: 'هدیه توکن تولید محتوا',
      message: `${amount} توکن تولید محتوا به حساب شما اضافه شد. از بخش «تولید محتوا» در پنل استفاده کنید.`,
    });
  }

  reject(
    targetUserId: string,
    reason: string,
  ): Promise<{ id: string; status: UserStatus; isVerified: boolean }> {
    return this.prisma.$transaction(async (tx) => {
      const updatedUser = await tx.user.update({
        where: { id: targetUserId },
        data: {
          status: UserStatus.REJECTED,
          isVerified: false,
          kycRejectionReason: reason,
          kycReviewedAt: new Date(),
        },
        select: { id: true, status: true, isVerified: true },
      });

      await this.notificationService.create({
        userId: targetUserId,
        type: NotificationType.KYC_REJECTED,
        title: 'احراز هویت رد شد',
        message: `مدارک هویتی شما رد شد. دلیل رد: ${reason}`,
        meta: { reason },
      });

      return updatedUser;
    });
  }
}
