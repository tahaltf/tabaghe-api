import { BadRequestException, Injectable } from '@nestjs/common';
import { PrismaService } from '../../../infrastructure/prisma/prisma.service';
import { SmsIrApiClient } from '../../sms/gateways/smsir-api.client';
import type { SmsIrTemplate, SmsIrTemplatesPage } from '../../sms/gateways/smsir.types';
import {
  buildSmsIrTemplateUsageMap,
  getSmsIrTemplateUsageKeys,
  type SmsIrTemplateUsageMap,
} from '../../sms/gateways/smsir-template-usage.util';

@Injectable()
export class AdminSmsIrService {
  constructor(
    private readonly smsIr: SmsIrApiClient,
    private readonly prisma: PrismaService,
  ) {}

  getCredit(): Promise<{ credit: number }> {
    return this.smsIr.getCredit().then((credit) => ({ credit }));
  }

  async getTemplates(
    page = 1,
    pageSize = 20,
    all = false,
  ): Promise<SmsIrTemplatesPage | { items: SmsIrTemplate[] }> {
    if (all) {
      const items = await this.smsIr.listAllTemplates();
      return { items };
    }
    return this.smsIr.listTemplates(page, pageSize);
  }

  createTemplate(title: string, templateText: string): Promise<SmsIrTemplate> {
    const trimmedTitle = title.trim();
    const trimmedText = templateText.trim();
    if (!/#\w+#/.test(trimmedText)) {
      throw new BadRequestException(
        'متن قالب باید حداقل یک متغیر با فرمت #name# داشته باشد',
      );
    }
    return this.smsIr.createTemplate(trimmedTitle, trimmedText);
  }

  async getTemplateUsage(): Promise<SmsIrTemplateUsageMap> {
    const keys = getSmsIrTemplateUsageKeys();
    const rows = await this.prisma.systemSetting.findMany({
      where: { key: { in: keys } },
      select: { key: true, value: true },
    });
    const siteSettings: Record<string, string | undefined> = {};
    let notificationRulesJson: string | null = null;
    for (const row of rows) {
      if (row.key === 'SMS_NOTIFICATION_RULES') {
        notificationRulesJson = row.value;
      } else {
        siteSettings[row.key] = row.value;
      }
    }
    return buildSmsIrTemplateUsageMap({ siteSettings, notificationRulesJson });
  }
}
