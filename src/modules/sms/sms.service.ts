import {
  Injectable,
  InternalServerErrorException,
  Logger,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import axios from 'axios';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { AppSettingsService } from '../../shared/settings/app-settings.service';

/**
 * کلیدهای `SystemSetting` (و در نبود مقدار، متغیر هم‌نام `.env`) برای قالب‌های sms.ir.
 * نام متغیر قالب باید دقیقاً مطابق پنل sms.ir باشد.
 */
export const SMS_SETTING_KEYS = {
  OTP_TEMPLATE_ID: 'SMS_OTP_TEMPLATE_ID',
  OTP_CODE_PARAMETER_NAME: 'SMS_OTP_CODE_PARAMETER_NAME',
  ADMIN_LOGIN_ALERT_ENABLED: 'SMS_ADMIN_LOGIN_ALERT_ENABLED',
  ADMIN_LOGIN_ALERT_TEMPLATE_ID: 'SMS_ADMIN_LOGIN_ALERT_TEMPLATE_ID',
  ADMIN_LOGIN_ALERT_RECIPIENTS: 'SMS_ADMIN_LOGIN_ALERT_RECIPIENTS',
  ADMIN_LOGIN_ALERT_USER_PHONE_PARAMETER:
    'SMS_ADMIN_LOGIN_ALERT_USER_PHONE_PARAMETER',
} as const;

const DEFAULT_OTP_TEMPLATE_ID = 591069;
const DEFAULT_OTP_CODE_PARAMETER = 'CONTACTS';
const DEFAULT_ADMIN_LOGIN_TEMPLATE_ID = 176584;
const DEFAULT_ADMIN_USER_PHONE_PARAMETER = 'PHONE';

@Injectable()
export class SmsService {
  private readonly logger = new Logger(SmsService.name);

  constructor(
    private readonly appSettings: AppSettingsService,
    private readonly prisma: PrismaService,
    private readonly configService: ConfigService,
  ) {}

  private async resolveSetting(key: string): Promise<string | undefined> {
    const row = await this.prisma.systemSetting.findUnique({
      where: { key },
      select: { value: true },
    });
    const fromDb = row?.value?.trim();
    if (fromDb) return fromDb;
    const fromEnv = this.configService.get<string>(key)?.trim();
    return fromEnv || undefined;
  }

  /** شماره موبایل ایران ۱۱ رقمی با صفر ابتدا */
  private normalizeIranMobile(raw: string): string | null {
    const d = String(raw ?? '').replace(/\D/g, '');
    if (d.length === 11 && d.startsWith('09')) return d;
    if (d.length === 10 && d.startsWith('9')) return `0${d}`;
    return null;
  }

  private parseRecipientList(raw: string | undefined): string[] {
    if (!raw?.trim()) return [];
    const parts = raw.split(/[,;\n\r]+/);
    const out: string[] = [];
    const seen = new Set<string>();
    for (const p of parts) {
      const n = this.normalizeIranMobile(p);
      if (n && !seen.has(n)) {
        seen.add(n);
        out.push(n);
      }
    }
    return out;
  }

  async sendByTemplate(
    phone: string,
    templateId: number,
    parameters: Array<{ name: string; value: string }>,
  ) {
    const mobile = this.normalizeIranMobile(phone);
    if (!mobile) {
      this.logger.warn(
        `SMS skipped: invalid mobile "${String(phone ?? '').trim()}"`,
      );
      throw new InternalServerErrorException('شماره موبایل نامعتبر است');
    }

    const apiKey = this.appSettings.getSmsApiKey();
    const url = 'https://api.sms.ir/v1/send/verify';

    try {
      const payload = {
        mobile,
        templateId,
        parameters,
      };

      const response = await axios.post(url, payload, {
        headers: {
          'X-API-KEY': apiKey,
          Accept: 'text/plain',
          'Content-Type': 'application/json',
        },
      });

      const status = Number(response.data?.status);
      if (status !== 1) {
        const message =
          response.data?.message || 'SMS.IR returned non-success status';
        this.logger.warn(
          `SMS.IR rejected template ${templateId} for ${mobile}: ${message}`,
        );
        throw new InternalServerErrorException(message);
      }
      this.logger.log(`SMS.IR accepted template ${templateId} for ${mobile}.`);
      return response.data;
    } catch (error: unknown) {
      if (error instanceof InternalServerErrorException) {
        throw error;
      }
      const err = error as { response?: { data?: { message?: string } } };
      const errorDetail = err.response?.data;
      throw new InternalServerErrorException(
        errorDetail?.message || 'خطا در برقراری ارتباط با سامانه پیامک',
      );
    }
  }

  async sendOtp(phone: string, code: string) {
    const tidRaw = await this.resolveSetting(SMS_SETTING_KEYS.OTP_TEMPLATE_ID);
    const templateId = Number.parseInt(tidRaw ?? '', 10);
    const templateIdFinal =
      Number.isFinite(templateId) && templateId > 0
        ? templateId
        : DEFAULT_OTP_TEMPLATE_ID;

    const paramName =
      (
        await this.resolveSetting(SMS_SETTING_KEYS.OTP_CODE_PARAMETER_NAME)
      )?.trim() || DEFAULT_OTP_CODE_PARAMETER;

    return this.sendByTemplate(phone, templateIdFinal, [
      { name: paramName, value: code },
    ]);
  }

  /**
   * پس از ورود موفق (OTP یا رمز ادمین)، به شماره‌های ادمین اطلاع می‌دهد.
   * گیرندگان: `SMS_ADMIN_LOGIN_ALERT_RECIPIENTS` (جدا با ویرگول/نقطه‌ویرگول/خط جدید).
   */
  async sendAdminLoginAlert(userPhone: string): Promise<void> {
    const enabledRaw =
      (await this.resolveSetting(SMS_SETTING_KEYS.ADMIN_LOGIN_ALERT_ENABLED)) ??
      'true';
    const off =
      enabledRaw === 'false' ||
      enabledRaw === '0' ||
      enabledRaw.toLowerCase() === 'no';
    if (off) {
      this.logger.debug('Admin login alert SMS disabled by setting.');
      return;
    }

    const tidRaw = await this.resolveSetting(
      SMS_SETTING_KEYS.ADMIN_LOGIN_ALERT_TEMPLATE_ID,
    );
    const templateId = Number.parseInt(tidRaw ?? '', 10);
    const templateIdFinal =
      Number.isFinite(templateId) && templateId > 0
        ? templateId
        : DEFAULT_ADMIN_LOGIN_TEMPLATE_ID;

    const paramName =
      (
        await this.resolveSetting(
          SMS_SETTING_KEYS.ADMIN_LOGIN_ALERT_USER_PHONE_PARAMETER,
        )
      )?.trim() || DEFAULT_ADMIN_USER_PHONE_PARAMETER;

    const recipientsRaw = await this.resolveSetting(
      SMS_SETTING_KEYS.ADMIN_LOGIN_ALERT_RECIPIENTS,
    );
    const recipients = this.parseRecipientList(recipientsRaw);
    if (!recipients.length) {
      this.logger.warn(
        'Admin login alert SMS skipped: set SMS_ADMIN_LOGIN_ALERT_RECIPIENTS in admin settings or .env (comma-separated mobiles).',
      );
      return;
    }

    const phoneValue = this.normalizeIranMobile(userPhone) ?? userPhone.trim();

    await Promise.all(
      recipients.map((mobile) =>
        this.sendByTemplate(mobile, templateIdFinal, [
          { name: paramName, value: phoneValue },
        ]),
      ),
    );
  }
}
