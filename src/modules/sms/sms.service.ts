import {
  Injectable,
  InternalServerErrorException,
  Logger,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { AppSettingsService } from '../../shared/settings/app-settings.service';
import { KavenegarProvider } from './gateways/kavenegar.provider';
import { SmsIrProvider } from './gateways/smsir.provider';
import {
  SmsProvider,
  SmsTemplateParameter,
  SmsTemplateRef,
} from './gateways/sms-provider.interface';

/**
 * کلیدهای `SystemSetting` (و در نبود مقدار، متغیر هم‌نام `.env`) برای قالب‌های SMS.
 * برای sms.ir: شناسه عددی قالب و نام پارامتر.
 * برای کاوه‌نگار: نام الگو (Lookup) در کلیدهای `*_TEMPLATE_NAME`.
 */
export const SMS_SETTING_KEYS = {
  OTP_TEMPLATE_ID: 'SMS_OTP_TEMPLATE_ID',
  OTP_TEMPLATE_NAME: 'SMS_OTP_TEMPLATE_NAME',
  OTP_CODE_PARAMETER_NAME: 'SMS_OTP_CODE_PARAMETER_NAME',
  WITHDRAW_OTP_TEMPLATE_ID: 'SMS_WITHDRAW_OTP_TEMPLATE_ID',
  WITHDRAW_OTP_TEMPLATE_NAME: 'SMS_WITHDRAW_OTP_TEMPLATE_NAME',
  WITHDRAW_OTP_CODE_PARAMETER_NAME: 'SMS_WITHDRAW_OTP_CODE_PARAMETER_NAME',
  ADMIN_LOGIN_ALERT_ENABLED: 'SMS_ADMIN_LOGIN_ALERT_ENABLED',
  ADMIN_LOGIN_ALERT_TEMPLATE_ID: 'SMS_ADMIN_LOGIN_ALERT_TEMPLATE_ID',
  ADMIN_LOGIN_ALERT_TEMPLATE_NAME: 'SMS_ADMIN_LOGIN_ALERT_TEMPLATE_NAME',
  ADMIN_LOGIN_ALERT_RECIPIENTS: 'SMS_ADMIN_LOGIN_ALERT_RECIPIENTS',
  ADMIN_LOGIN_ALERT_USER_PHONE_PARAMETER:
    'SMS_ADMIN_LOGIN_ALERT_USER_PHONE_PARAMETER',
} as const;

const DEFAULT_OTP_TEMPLATE_ID = 591069;
const DEFAULT_OTP_CODE_PARAMETER = 'CONTACTS';
const DEFAULT_WITHDRAW_OTP_TEMPLATE_ID = 591069;
const DEFAULT_WITHDRAW_OTP_CODE_PARAMETER = 'CONTACTS';
const DEFAULT_ADMIN_LOGIN_TEMPLATE_ID = 176584;
const DEFAULT_ADMIN_USER_PHONE_PARAMETER = 'PHONE';

@Injectable()
export class SmsService {
  private readonly logger = new Logger(SmsService.name);

  constructor(
    private readonly appSettings: AppSettingsService,
    private readonly prisma: PrismaService,
    private readonly configService: ConfigService,
    private readonly smsIrProvider: SmsIrProvider,
    private readonly kavenegarProvider: KavenegarProvider,
  ) {}

  getActiveProviderName() {
    return this.appSettings.getActiveSmsProvider();
  }

  private getProvider(): SmsProvider {
    const active = this.appSettings.getActiveSmsProvider();
    if (active === 'kavenegar') return this.kavenegarProvider;
    return this.smsIrProvider;
  }

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
  normalizeIranMobile(raw: string): string | null {
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
    template: SmsTemplateRef | number,
    parameters: SmsTemplateParameter[],
  ) {
    const mobile = this.normalizeIranMobile(phone);
    if (!mobile) {
      this.logger.warn(
        `SMS skipped: invalid mobile "${String(phone ?? '').trim()}"`,
      );
      throw new InternalServerErrorException('شماره موبایل نامعتبر است');
    }

    const templateRef: SmsTemplateRef =
      typeof template === 'number' ? { templateId: template } : template;

    return this.getProvider().sendByTemplate(mobile, templateRef, parameters);
  }

  private async resolveOtpTemplate(): Promise<SmsTemplateRef> {
    if (this.appSettings.getActiveSmsProvider() === 'kavenegar') {
      const name =
        (await this.resolveSetting(SMS_SETTING_KEYS.OTP_TEMPLATE_NAME))?.trim() ||
        '';
      return { templateName: name };
    }

    const tidRaw = await this.resolveSetting(SMS_SETTING_KEYS.OTP_TEMPLATE_ID);
    const templateId = Number.parseInt(tidRaw ?? '', 10);
    const templateIdFinal =
      Number.isFinite(templateId) && templateId > 0
        ? templateId
        : DEFAULT_OTP_TEMPLATE_ID;
    return { templateId: templateIdFinal };
  }

  private async resolveWithdrawOtpTemplate(): Promise<SmsTemplateRef> {
    if (this.appSettings.getActiveSmsProvider() === 'kavenegar') {
      const name =
        (
          await this.resolveSetting(SMS_SETTING_KEYS.WITHDRAW_OTP_TEMPLATE_NAME)
        )?.trim() || '';
      return { templateName: name };
    }

    const tidRaw = await this.resolveSetting(
      SMS_SETTING_KEYS.WITHDRAW_OTP_TEMPLATE_ID,
    );
    const templateId = Number.parseInt(tidRaw ?? '', 10);
    const templateIdFinal =
      Number.isFinite(templateId) && templateId > 0
        ? templateId
        : DEFAULT_WITHDRAW_OTP_TEMPLATE_ID;
    return { templateId: templateIdFinal };
  }

  private async resolveAdminLoginAlertTemplate(): Promise<SmsTemplateRef> {
    if (this.appSettings.getActiveSmsProvider() === 'kavenegar') {
      const name =
        (
          await this.resolveSetting(
            SMS_SETTING_KEYS.ADMIN_LOGIN_ALERT_TEMPLATE_NAME,
          )
        )?.trim() || '';
      return { templateName: name };
    }

    const tidRaw = await this.resolveSetting(
      SMS_SETTING_KEYS.ADMIN_LOGIN_ALERT_TEMPLATE_ID,
    );
    const templateId = Number.parseInt(tidRaw ?? '', 10);
    const templateIdFinal =
      Number.isFinite(templateId) && templateId > 0
        ? templateId
        : DEFAULT_ADMIN_LOGIN_TEMPLATE_ID;
    return { templateId: templateIdFinal };
  }

  async sendOtp(phone: string, code: string) {
    const template = await this.resolveOtpTemplate();

    const paramName =
      (
        await this.resolveSetting(SMS_SETTING_KEYS.OTP_CODE_PARAMETER_NAME)
      )?.trim() || DEFAULT_OTP_CODE_PARAMETER;

    return this.sendByTemplate(phone, template, [
      { name: paramName, value: code },
    ]);
  }

  async sendWithdrawOtp(phone: string, code: string) {
    const template = await this.resolveWithdrawOtpTemplate();

    const paramName =
      (
        await this.resolveSetting(
          SMS_SETTING_KEYS.WITHDRAW_OTP_CODE_PARAMETER_NAME,
        )
      )?.trim() || DEFAULT_WITHDRAW_OTP_CODE_PARAMETER;

    return this.sendByTemplate(phone, template, [
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

    const template = await this.resolveAdminLoginAlertTemplate();

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
        this.sendByTemplate(mobile, template, [
          { name: paramName, value: phoneValue },
        ]),
      ),
    );
  }
}
