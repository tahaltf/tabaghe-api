import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  buildSmsWebOtpTemplateGuide,
  assertSmsWebOtpOriginConfigured,
} from '../../common/sms/web-otp-template.util';
import { SMS_SETTING_KEYS } from '../sms/sms.service';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';

/**
 * Logs Web OTP SMS template requirements on startup so ops can verify sms.ir template 591069.
 */
@Injectable()
export class SmsTemplateBootstrapService implements OnModuleInit {
  private readonly logger = new Logger(SmsTemplateBootstrapService.name);

  constructor(
    private readonly configService: ConfigService,
    private readonly prisma: PrismaService,
  ) {}

  async onModuleInit(): Promise<void> {
    const paramRow = await this.prisma.systemSetting.findUnique({
      where: { key: SMS_SETTING_KEYS.OTP_CODE_PARAMETER_NAME },
      select: { value: true },
    });
    const paramName =
      paramRow?.value?.trim() ||
      this.configService.get<string>(SMS_SETTING_KEYS.OTP_CODE_PARAMETER_NAME)?.trim() ||
      'CONTACTS';

    const guide = buildSmsWebOtpTemplateGuide(paramName);
    for (const line of guide.checklist) {
      this.logger.log(`[SMS Web OTP] ${line}`);
    }
    this.logger.log(`[SMS Web OTP] Example body:\n${guide.exampleBody}`);

    for (const warning of assertSmsWebOtpOriginConfigured()) {
      this.logger.warn(`[SMS Web OTP] ${warning}`);
    }

    if (process.env.NODE_ENV === 'production' && !process.env.SMS_WEB_OTP_TEMPLATE_CONFIRMED) {
      this.logger.warn(
        '[SMS Web OTP] Set SMS_WEB_OTP_TEMPLATE_CONFIRMED=true after verifying sms.ir template in production.',
      );
    }
  }
}
