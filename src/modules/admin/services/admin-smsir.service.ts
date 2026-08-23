import { BadRequestException, Injectable } from '@nestjs/common';
import { SmsIrApiClient } from '../../sms/gateways/smsir-api.client';
import type { SmsIrTemplate, SmsIrTemplatesPage } from '../../sms/gateways/smsir.types';

@Injectable()
export class AdminSmsIrService {
  constructor(private readonly smsIr: SmsIrApiClient) {}

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
}
