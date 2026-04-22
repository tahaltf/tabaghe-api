import { Injectable, UnauthorizedException } from '@nestjs/common';
import { User, UserStatus } from '@prisma/client';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import {
  AuthSessionResponse,
  JwtPayload,
} from '../../shared/contracts/auth';
import { OtpIssueResult, OtpService } from './services/otp.service';
import { TokenService } from './services/token.service';

@Injectable()
export class AuthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly otpService: OtpService,
    private readonly tokenService: TokenService,
  ) {}

  async requestOtp(phone: string): Promise<OtpIssueResult> {
    return this.otpService.issue(phone);
  }

  async verifyOtp(phone: string, code: string): Promise<AuthSessionResponse> {
    await this.otpService.consume(phone, code);
    const user = await this.findOrCreateUser(phone);
    return this.buildSession(user);
  }

  async refresh(refreshToken: string): Promise<AuthSessionResponse> {
    const payload = this.tokenService.verifyRefresh(refreshToken);
    const user = await this.prisma.user.findUnique({ where: { id: payload.sub } });
    if (!user) throw new UnauthorizedException('کاربر یافت نشد.');
    return this.buildSession(user);
  }

  private async findOrCreateUser(phone: string): Promise<User> {
    return this.prisma.$transaction(async (tx) => {
      const existing = await tx.user.findUnique({ where: { phone } });
      if (existing) return existing;

      const created = await tx.user.create({
        data: { phone, status: UserStatus.INCOMPLETE },
      });
      await tx.wallet.create({ data: { userId: created.id } });
      return created;
    });
  }

  private buildSession(user: User): AuthSessionResponse {
    const payload: JwtPayload = {
      sub: user.id,
      phone: user.phone,
      role: user.role,
      status: user.status,
      isVerified: user.isVerified,
    };
    const tokens = this.tokenService.signPair(payload);
    return {
      accessToken: tokens.accessToken,
      refreshToken: tokens.refreshToken,
      user: {
        id: user.id,
        phone: user.phone,
        role: user.role,
        status: user.status,
        isVerified: user.isVerified,
      },
    };
  }
}
