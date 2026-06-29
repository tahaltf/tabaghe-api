import { BadRequestException, Injectable } from '@nestjs/common';
import { NotificationType } from '@prisma/client';
import { PrismaService } from '../../../infrastructure/prisma/prisma.service';
import { NotificationService } from '../../notification/notification.service';
import { SmsService } from '../../sms/sms.service';
import { SmsTemplateRef } from '../../sms/gateways/sms-provider.interface';
import { applySmsTemplatePlaceholders } from '../../../common/sms/sms-placeholders.util';
import { isUserOperationalSmsEnabled } from '../../../common/notification/user-sms-notification.util';

@Injectable()
export class AdminSmsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly sms: SmsService,
    private readonly notifications: NotificationService,
  ) {}

  async broadcast(params: {
    templateId?: number;
    templateName?: string;
    parameterName: string;
    parameterValue: string;
    userIds?: string[];
    siteTitle?: string;
    alsoCreateSiteNotification?: boolean;
  }) {
    const {
      templateId,
      templateName,
      parameterName,
      parameterValue,
      userIds,
      siteTitle,
      alsoCreateSiteNotification,
    } = params;

    const templateRef = await this.resolveTemplateRef(templateId, templateName);
    if (!templateRef) {
      throw new BadRequestException('قالب پیامک برای پرووایدر فعال تنظیم نشده است');
    }

    const users = await this.prisma.user.findMany({
      where:
        userIds === undefined
          ? {}
          : userIds.length > 0
            ? { id: { in: userIds } }
            : { id: { in: [] } },
      select: {
        id: true,
        phone: true,
        firstName: true,
        lastName: true,
        notifySms: true,
      },
    });

    const createSite = alsoCreateSiteNotification !== false;
    const inAppTitle = siteTitle?.trim() || 'اطلاعیه طبقه';
    const inAppMessage = parameterValue.trim();

    let sent = 0;
    let failed = 0;
    let skippedOptOut = 0;
    let siteCreated = 0;
    for (const user of users) {
      if (user.phone && isUserOperationalSmsEnabled(user.notifySms)) {
        try {
          await this.sms.sendByTemplate(user.phone, templateRef, [
            {
              name: parameterName,
              value: applySmsTemplatePlaceholders(parameterValue, {
                firstName: user.firstName,
                lastName: user.lastName,
              }),
            },
          ]);
          sent++;
        } catch {
          failed++;
        }
      } else if (user.phone && !isUserOperationalSmsEnabled(user.notifySms)) {
        skippedOptOut++;
      } else {
        failed++;
      }

      if (createSite && inAppMessage.length >= 2) {
        await this.notifications.create({
          userId: user.id,
          type: NotificationType.ADMIN_ANNOUNCEMENT,
          title: inAppTitle,
          message: inAppMessage,
          forceSiteNotification: true,
        });
        siteCreated++;
      }
    }

    return { total: users.length, sent, failed, skippedOptOut, siteCreated };
  }

  private async resolveTemplateRef(
    templateId?: number,
    templateName?: string,
  ): Promise<SmsTemplateRef | undefined> {
    const provider = await this.sms.getActiveProviderName();
    if (provider === 'kavenegar') {
      const name = templateName?.trim();
      return name ? { templateName: name } : undefined;
    }
    const id = Number(templateId);
    if (Number.isFinite(id) && id > 0) {
      return { templateId: id };
    }
    return undefined;
  }
}
