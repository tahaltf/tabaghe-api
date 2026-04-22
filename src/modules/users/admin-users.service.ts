import { Injectable } from '@nestjs/common';
import { Prisma, UserStatus } from '@prisma/client';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';

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

export type KycRequest = Prisma.UserGetPayload<{ select: typeof KYC_REQUEST_SELECT }>;

@Injectable()
export class AdminUsersService {
  constructor(private readonly prisma: PrismaService) {}

  listPendingKyc(): Promise<KycRequest[]> {
    return this.prisma.user.findMany({
      where: { status: UserStatus.PENDING },
      select: KYC_REQUEST_SELECT,
      orderBy: { updatedAt: 'asc' },
    });
  }

  approve(targetUserId: string): Promise<{ id: string; status: UserStatus; isVerified: boolean }> {
    return this.prisma.user.update({
      where: { id: targetUserId },
      data: {
        status: UserStatus.APPROVED,
        isVerified: true,
        kycRejectionReason: null,
        kycReviewedAt: new Date(),
      },
      select: { id: true, status: true, isVerified: true },
    });
  }

  reject(
    targetUserId: string,
    reason: string,
  ): Promise<{ id: string; status: UserStatus; isVerified: boolean }> {
    return this.prisma.user.update({
      where: { id: targetUserId },
      data: {
        status: UserStatus.REJECTED,
        isVerified: false,
        kycRejectionReason: reason,
        kycReviewedAt: new Date(),
      },
      select: { id: true, status: true, isVerified: true },
    });
  }
}
