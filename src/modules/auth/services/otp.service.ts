import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { OtpPurpose } from '@prisma/client';
import { PrismaService } from '../../../infrastructure/prisma/prisma.service';
import { SmsService } from '../../sms/sms.service';

const OTP_TTL_MINUTES = 5;
const OTP_RESEND_COOLDOWN_MS = 2 * 60 * 1000;
const TEST_PHONE = '09190949469';
const TEST_CODE = '11111';

export interface OtpIssueResult {
  sent: boolean;
  /** در حالت dev اگر سرویس پیامک در دسترس نباشد، warning می‌دهیم تا از لاگ کد بخوانیم. */
  warning?: string;
}

@Injectable()
export class OtpService {
  private readonly logger = new Logger(OtpService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly smsService: SmsService,
    private readonly configService: ConfigService,
  ) {}

  async issue(
    phone: string,
    purpose: OtpPurpose = OtpPurpose.LOGIN,
  ): Promise<OtpIssueResult> {
    await this.enforceCooldown(phone);

    const code = this.generateCode(phone);
    const expiresAt = new Date(Date.now() + OTP_TTL_MINUTES * 60 * 1000);

    await this.prisma.$transaction([
      this.prisma.otpCode.deleteMany({ where: { phone } }),
      this.prisma.otpCode.create({
        data: { phone, code, expiresAt, purpose },
      }),
    ]);

    this.logger.log(`OTP issued for ${phone}: ${code}`);

    if (phone === TEST_PHONE) {
      return { sent: true };
    }

    try {
      await this.smsService.sendOtp(phone, code);
      return { sent: true };
    } catch (error) {
      const isProd =
        this.configService.get<string>('NODE_ENV') === 'production';
      if (isProd) throw error;
      this.logger.warn(
        `SMS provider failed in dev, code available in logs. err=${
          error instanceof Error ? error.message : String(error)
        }`,
      );
      return {
        sent: false,
        warning: 'پیامک ارسال نشد؛ در محیط توسعه کد را از لاگ سرور بخوان.',
      };
    }
  }

  async consume(phone: string, code: string): Promise<void> {
    const record = await this.prisma.otpCode.findFirst({
      where: { phone, code, expiresAt: { gt: new Date() }, usedAt: null },
      orderBy: { createdAt: 'desc' },
    });

    if (!record) {
      throw new BadRequestException('کد وارد شده اشتباه یا منقضی شده است.');
    }

    await this.prisma.otpCode.updateMany({
      where: { id: record.id },
      data: { usedAt: new Date() },
    });
  }

  private async enforceCooldown(phone: string): Promise<void> {
    const recent = await this.prisma.otpCode.findFirst({
      where: { phone },
      orderBy: { createdAt: 'desc' },
    });
    if (!recent) return;
    const elapsed = Date.now() - recent.createdAt.getTime();
    if (elapsed < OTP_RESEND_COOLDOWN_MS) {
      const remaining = Math.ceil((OTP_RESEND_COOLDOWN_MS - elapsed) / 1000);
      throw new BadRequestException(
        `لطفاً ${remaining} ثانیه صبر کنید و دوباره امتحان کنید.`,
      );
    }
  }

  private generateCode(phone: string): string {
    if (phone === TEST_PHONE) return TEST_CODE;
    return Math.floor(10000 + Math.random() * 90000).toString();
  }
}
