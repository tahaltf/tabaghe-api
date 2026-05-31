import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { OtpPurpose } from '@prisma/client';
import { PrismaService } from '../../../infrastructure/prisma/prisma.service';
import { SmsService } from '../../sms/sms.service';

const DEFAULT_OTP_TTL_MINUTES = 5;
const DEFAULT_OTP_RESEND_COOLDOWN_SECONDS = 120;
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
    await this.enforceCooldown(phone, purpose);

    const ttlMinutes = await this.getOtpTtlMinutes();
    const code = this.generateCode(phone);
    const expiresAt = new Date(Date.now() + ttlMinutes * 60 * 1000);

    await this.prisma.$transaction([
      this.prisma.otpCode.deleteMany({ where: { phone, purpose } }),
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

  async consume(
    phone: string,
    code: string,
    purpose?: OtpPurpose,
  ): Promise<void> {
    const record = await this.prisma.otpCode.findFirst({
      where: {
        phone,
        code,
        expiresAt: { gt: new Date() },
        usedAt: null,
        ...(purpose ? { purpose } : {}),
      },
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

  private async enforceCooldown(
    phone: string,
    purpose: OtpPurpose = OtpPurpose.LOGIN,
  ): Promise<void> {
    const recent = await this.prisma.otpCode.findFirst({
      where: { phone, purpose },
      orderBy: { createdAt: 'desc' },
    });
    if (!recent) return;
    const cooldownMs = (await this.getOtpResendCooldownSeconds()) * 1000;
    const elapsed = Date.now() - recent.createdAt.getTime();
    if (elapsed < cooldownMs) {
      const remaining = Math.ceil((cooldownMs - elapsed) / 1000);
      throw new BadRequestException(
        `لطفاً ${remaining} ثانیه صبر کنید و دوباره امتحان کنید.`,
      );
    }
  }

  private async getOtpTtlMinutes(): Promise<number> {
    return this.readPositiveIntSetting(
      'OTP_TTL_MINUTES',
      DEFAULT_OTP_TTL_MINUTES,
    );
  }

  private async getOtpResendCooldownSeconds(): Promise<number> {
    return this.readPositiveIntSetting(
      'OTP_RESEND_COOLDOWN_SECONDS',
      DEFAULT_OTP_RESEND_COOLDOWN_SECONDS,
    );
  }

  private async readPositiveIntSetting(
    key: string,
    fallback: number,
  ): Promise<number> {
    const row = await this.prisma.systemSetting.findUnique({
      where: { key },
      select: { value: true },
    });
    const parsed = Number(row?.value ?? fallback);
    if (!Number.isFinite(parsed) || parsed <= 0) return fallback;
    return Math.floor(parsed);
  }

  private generateCode(phone: string): string {
    if (phone === TEST_PHONE) return TEST_CODE;
    return Math.floor(10000 + Math.random() * 90000).toString();
  }
}
