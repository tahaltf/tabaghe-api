import {
  BadRequestException,
  Injectable,
  Logger,
  UnauthorizedException,
} from '@nestjs/common';
import { User, UserRole, UserStatus, NotificationType, OtpPurpose } from '@prisma/client';
import * as bcrypt from 'bcrypt';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { AuthSessionResponse, JwtPayload } from '../../shared/contracts/auth';
import { OtpIssueResult, OtpService } from './services/otp.service';
import { TokenService } from './services/token.service';
import { SmsService } from '../sms/sms.service';
import { NotificationService } from '../notification/notification.service';

const ADMIN_DEFAULT_PASSWORD = '@Ab123456789@';

export interface AdminPasswordLoginChallengeResponse {
  challengeToken: string;
  maskedPhone: string;
  otpSent: boolean;
  warning?: string;
}

@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly otpService: OtpService,
    private readonly tokenService: TokenService,
    private readonly smsService: SmsService,
    private readonly notifications: NotificationService,
  ) {}

  async requestOtp(phone: string): Promise<OtpIssueResult> {
    return this.otpService.issue(phone);
  }

  async verifyOtp(phone: string, code: string): Promise<AuthSessionResponse> {
    await this.otpService.consume(phone, code);
    const existed = await this.prisma.user.findUnique({
      where: { phone },
      select: { id: true },
    });
    const user = await this.findOrCreateUser(phone);
    const isNewUser = !existed;
    const session = this.buildSession(user);
    this.notifyAdminAboutLogin(user.phone);
    if (isNewUser) {
      void this.notifications
        .notifyAdminPersonnel({
          type: NotificationType.ADMIN_ALERT_NEW_USER,
          title: 'کاربر جدید',
          message: `کاربر جدید با شماره ${user.phone} ثبت‌نام کرد.`,
          meta: { userId: user.id },
        })
        .catch((err) => {
          this.logger.warn(
            `notifyAdminPersonnel NEW_USER failed: ${String((err as Error)?.message ?? err)}`,
          );
        });
    }
    return session;
  }

  /** مرحله ۱ ورود ادمین: اعتبارسنجی رمز و ارسال OTP پیامکی */
  async requestAdminPasswordLogin(
    username: string,
    password: string,
  ): Promise<AdminPasswordLoginChallengeResponse> {
    const user = await this.validateAdminPassword(username, password);
    const otpResult = await this.otpService.issue(
      user.phone,
      OtpPurpose.ADMIN_LOGIN,
    );
    return {
      challengeToken: this.tokenService.signAdminLoginChallenge(user.id),
      maskedPhone: this.maskPhone(user.phone),
      otpSent: otpResult.sent,
      warning: otpResult.warning,
    };
  }

  /** مرحله ۲ ورود ادمین: تایید OTP و صدور توکن */
  async verifyAdminLoginOtp(
    challengeToken: string,
    code: string,
  ): Promise<AuthSessionResponse> {
    const userId = this.tokenService.verifyAdminLoginChallenge(challengeToken);
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user) {
      throw new UnauthorizedException('حساب ادمین یافت نشد.');
    }
    if (!user.isActive) {
      throw new UnauthorizedException('حساب کاربری غیرفعال است.');
    }
    if (user.role !== UserRole.ADMIN && user.role !== UserRole.GODADMIN) {
      throw new UnauthorizedException('دسترسی ادمین مجاز نیست.');
    }

    const normalizedCode = code.trim();
    if (!/^\d{4,6}$/.test(normalizedCode)) {
      throw new BadRequestException('کد تایید نامعتبر است.');
    }

    await this.otpService.consume(
      user.phone,
      normalizedCode,
      OtpPurpose.ADMIN_LOGIN,
    );

    const session = this.buildSession(user);
    this.notifyAdminAboutLogin(user.phone);
    return session;
  }

  private async validateAdminPassword(
    username: string,
    password: string,
  ): Promise<User> {
    const login = username.trim();
    const user = await this.prisma.user.findFirst({
      where: {
        OR: [
          { phone: login },
          { email: { equals: login, mode: 'insensitive' } },
        ],
      },
    });

    if (!user) {
      throw new UnauthorizedException('نام کاربری یا رمز عبور اشتباه است.');
    }

    if (!user.isActive) {
      throw new UnauthorizedException('حساب کاربری غیرفعال است.');
    }

    if (user.role !== UserRole.ADMIN && user.role !== UserRole.GODADMIN) {
      throw new UnauthorizedException(
        'ورود با رمز عبور فقط برای ادمین مجاز است.',
      );
    }

    let isValid = false;
    if (user.passwordHash) {
      isValid = await bcrypt.compare(password, user.passwordHash);
    } else if (password === ADMIN_DEFAULT_PASSWORD) {
      isValid = true;
      const hashed = await bcrypt.hash(ADMIN_DEFAULT_PASSWORD, 10);
      await this.prisma.user.update({
        where: { id: user.id },
        data: { passwordHash: hashed },
      });
    }

    if (!isValid) {
      throw new UnauthorizedException('نام کاربری یا رمز عبور اشتباه است.');
    }

    return user;
  }

  private maskPhone(phone: string): string {
    const digits = phone.replace(/\D/g, '');
    if (digits.length < 8) return '***';
    return `${digits.slice(0, 4)}***${digits.slice(-3)}`;
  }

  async refresh(refreshToken: string): Promise<AuthSessionResponse> {
    const payload = this.tokenService.verifyRefresh(refreshToken);
    const user = await this.prisma.user.findUnique({
      where: { id: payload.sub },
    });
    if (!user) throw new UnauthorizedException('کاربر یافت نشد.');
    if (!user.isActive)
      throw new UnauthorizedException('حساب کاربری غیرفعال است.');
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

  private notifyAdminAboutLogin(phone: string): void {
    this.logger.log(`Sending admin login alert SMS for ${phone}.`);
    this.smsService.sendAdminLoginAlert(phone).catch((error: unknown) => {
      this.logger.warn(
        `Failed to send admin login alert SMS for ${phone}: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    });
  }
}
