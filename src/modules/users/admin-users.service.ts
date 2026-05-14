import { Injectable } from '@nestjs/common';
import { NotificationType, Prisma, UserStatus } from '@prisma/client';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { NotificationService } from '../notification/notification.service';

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
        'مدارک هویتی شما توسط ادمین تایید شد و اکنون حساب کاربری شما فعال است.',
    });

    return updatedUser;
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
