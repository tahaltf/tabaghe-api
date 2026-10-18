import { BadRequestException, Injectable } from '@nestjs/common';
import { PrismaService } from '../../../infrastructure/prisma/prisma.service';
import { SmsIrApiClient } from '../../sms/gateways/smsir-api.client';
import type {
  SmsIrArchiveParams,
  SmsIrMessageReport,
  SmsIrPackSummary,
  SmsIrPageParams,
  SmsIrReceiveArchiveParams,
  SmsIrReceivedMessage,
  SmsIrReceiveLiveParams,
  SmsIrSendBulkResult,
  SmsIrTemplate,
  SmsIrTemplatesPage,
  SmsIrVerifyParameter,
  SmsIrVerifyResult,
} from '../../sms/gateways/smsir.types';
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

  async getLines(): Promise<{ lines: number[]; defaultLineNumber: number | null }> {
    const lines = await this.smsIr.listLines();
    return {
      lines,
      defaultLineNumber: this.smsIr.getDefaultLineNumber(),
    };
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

  getTemplate(templateId: number): Promise<SmsIrTemplate> {
    return this.smsIr.getTemplate(templateId);
  }

  createTemplate(
    title: string,
    templateText: string,
    type?: number,
  ): Promise<SmsIrTemplate> {
    const trimmedTitle = title.trim();
    const trimmedText = templateText.trim();
    if (!/#\w+#/.test(trimmedText)) {
      throw new BadRequestException(
        'متن قالب باید حداقل یک متغیر با فرمت #name# داشته باشد',
      );
    }
    return this.smsIr.createTemplate(trimmedTitle, trimmedText, type);
  }

  updateTemplate(
    templateId: number,
    title: string,
    templateText: string,
    type?: number,
  ): Promise<SmsIrTemplate> {
    const trimmedTitle = title.trim();
    const trimmedText = templateText.trim();
    if (!/#\w+#/.test(trimmedText)) {
      throw new BadRequestException(
        'متن قالب باید حداقل یک متغیر با فرمت #name# داشته باشد',
      );
    }
    return this.smsIr.updateTemplate(
      templateId,
      trimmedTitle,
      trimmedText,
      type,
    );
  }

  deleteTemplate(templateId: number): Promise<{ ok: boolean }> {
    return this.smsIr.deleteTemplate(templateId).then(() => ({ ok: true }));
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

  sendBulk(input: {
    lineNumber?: number;
    messageText: string;
    mobiles: string[];
    sendDateTime?: number | null;
  }): Promise<SmsIrSendBulkResult> {
    const mobiles = this.normalizeMobiles(input.mobiles);
    return this.smsIr.sendBulk({
      lineNumber: this.resolveLineNumber(input.lineNumber),
      messageText: input.messageText.trim(),
      mobiles,
      sendDateTime: this.normalizeSendDateTime(input.sendDateTime),
    });
  }

  sendLikeToLike(input: {
    lineNumber?: number;
    messageTexts: string[];
    mobiles: string[];
    sendDateTime?: number | null;
  }): Promise<SmsIrSendBulkResult> {
    const mobiles = this.normalizeMobiles(input.mobiles);
    const messageTexts = input.messageTexts.map((t) => String(t ?? '').trim());
    if (messageTexts.length !== mobiles.length) {
      throw new BadRequestException(
        'تعداد شماره موبایل‌ها و متن‌های پیامک باید برابر باشند',
      );
    }
    if (messageTexts.some((t) => !t)) {
      throw new BadRequestException('متن پیامک نمی‌تواند خالی باشد');
    }
    return this.smsIr.sendLikeToLike({
      lineNumber: this.resolveLineNumber(input.lineNumber),
      messageTexts,
      mobiles,
      sendDateTime: this.normalizeSendDateTime(input.sendDateTime),
    });
  }

  deleteScheduled(packId: string): Promise<{ ok: boolean }> {
    const id = packId?.trim();
    if (!id) {
      throw new BadRequestException('شناسه مجموعه ارسال (packId) الزامی است');
    }
    return this.smsIr.deleteScheduled(id).then(() => ({ ok: true }));
  }

  sendVerify(input: {
    mobile: string;
    templateId: number;
    parameters: SmsIrVerifyParameter[];
  }): Promise<SmsIrVerifyResult> {
    const mobile = this.normalizeMobile(input.mobile);
    const parameters = (input.parameters ?? []).map((p) => ({
      name: String(p.name ?? '').trim(),
      value: String(p.value ?? '').trim(),
    }));
    if (!parameters.length || parameters.some((p) => !p.name || !p.value)) {
      throw new BadRequestException('پارامترهای قالب را کامل وارد کنید');
    }
    if (parameters.some((p) => p.value.length > 25)) {
      throw new BadRequestException('مقدار هر پارامتر حداکثر ۲۵ کاراکتر است');
    }
    return this.smsIr.sendVerify({
      mobile,
      templateId: input.templateId,
      parameters,
    });
  }

  sendSimple(input: {
    lineNumber?: number;
    mobile: string;
    text: string;
  }): Promise<SmsIrSendBulkResult> {
    return this.smsIr.sendSimple({
      lineNumber: this.resolveLineNumber(input.lineNumber),
      mobile: this.normalizeMobile(input.mobile),
      text: input.text.trim(),
    });
  }

  getMessageReport(messageId: number): Promise<SmsIrMessageReport> {
    if (!Number.isFinite(messageId) || messageId <= 0) {
      throw new BadRequestException('شناسه پیامک نامعتبر است');
    }
    return this.smsIr.getMessageReport(messageId);
  }

  getTodayPacks(params: SmsIrPageParams): Promise<SmsIrPackSummary[]> {
    return this.smsIr.getTodayPacks(params);
  }

  getPackMessages(packId: string): Promise<SmsIrMessageReport[]> {
    const id = packId?.trim();
    if (!id) {
      throw new BadRequestException('شناسه مجموعه ارسال الزامی است');
    }
    return this.smsIr.getPackMessages(id);
  }

  getLiveSends(params: SmsIrPageParams): Promise<SmsIrMessageReport[]> {
    return this.smsIr.getLiveSends(params);
  }

  getArchivedSends(params: SmsIrArchiveParams): Promise<SmsIrMessageReport[]> {
    return this.smsIr.getArchivedSends(params);
  }

  getLatestReceived(count?: number): Promise<SmsIrReceivedMessage[]> {
    return this.smsIr.getLatestReceived(count ?? 100);
  }

  getLiveReceived(
    params: SmsIrReceiveLiveParams,
  ): Promise<SmsIrReceivedMessage[]> {
    return this.smsIr.getLiveReceived(params);
  }

  getArchivedReceived(
    params: SmsIrReceiveArchiveParams,
  ): Promise<SmsIrReceivedMessage[]> {
    return this.smsIr.getArchivedReceived(params);
  }

  private resolveLineNumber(lineNumber?: number | null): number {
    if (lineNumber != null && Number.isFinite(Number(lineNumber))) {
      return Number(lineNumber);
    }
    const fallback = this.smsIr.getDefaultLineNumber();
    if (fallback == null) {
      throw new BadRequestException(
        'شماره خط را وارد کنید یا SMS_IR_LINE_NUMBER را در کلیدهای سرور تنظیم کنید',
      );
    }
    return fallback;
  }

  private normalizeMobiles(mobiles: string[]): string[] {
    const list = (mobiles ?? [])
      .map((m) => this.normalizeMobile(String(m ?? '')))
      .filter(Boolean);
    if (!list.length) {
      throw new BadRequestException('حداقل یک شماره موبایل وارد کنید');
    }
    if (list.length > 100) {
      throw new BadRequestException('حداکثر ۱۰۰ شماره موبایل مجاز است');
    }
    return list;
  }

  private normalizeMobile(mobile: string): string {
    let m = mobile.trim().replace(/[\s\-]/g, '');
    m = m.replace(/[۰-۹]/g, (d) => String('۰۱۲۳۴۵۶۷۸۹'.indexOf(d)));
    if (m.startsWith('+98')) m = '0' + m.slice(3);
    if (m.startsWith('98') && m.length === 12) m = '0' + m.slice(2);
    if (!m) {
      throw new BadRequestException('شماره موبایل نامعتبر است');
    }
    return m;
  }

  private normalizeSendDateTime(
    sendDateTime?: number | null,
  ): number | null | undefined {
    if (sendDateTime == null || sendDateTime === 0) return undefined;
    const ts = Number(sendDateTime);
    if (!Number.isFinite(ts) || ts <= 0) {
      throw new BadRequestException('زمان ارسال نامعتبر است');
    }
    const now = Math.floor(Date.now() / 1000);
    const min = now + 3600;
    const max = now + 365 * 24 * 3600;
    if (ts < min) {
      throw new BadRequestException(
        'زمان ارسال زمانبندی‌شده باید حداقل یک ساعت آینده باشد',
      );
    }
    if (ts > max) {
      throw new BadRequestException(
        'زمان ارسال زمانبندی‌شده حداکثر ۳۶۵ روز آینده مجاز است',
      );
    }
    return ts;
  }
}
