import { Injectable } from '@nestjs/common';
import { NotificationType } from '@prisma/client';
import { PrismaService } from '../../../infrastructure/prisma/prisma.service';
import { NotificationService } from '../../notification/notification.service';
import { SmsService } from '../../sms/sms.service';
import { applySmsTemplatePlaceholders } from '../../../common/sms/sms-placeholders.util';

@Injectable()
export class AdminSmsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly sms: SmsService,
    private readonly notifications: NotificationService,
  ) {}

  async broadcast(params: {
    templateId: number;
    parameterName: string;
    parameterValue: string;
    userIds?: string[];
    siteTitle?: string;
    alsoCreateSiteNotification?: boolean;
  }) {
    const {
      templateId,
      parameterName,
      parameterValue,
      userIds,
      siteTitle,
      alsoCreateSiteNotification,
    } = params;
    const users = await this.prisma.user.findMany({
      where:
        userIds === undefined
          ? {}
          : userIds.length > 0
            ? { id: { in: userIds } }
            : { id: { in: [] } },
      select: { id: true, phone: true, firstName: true, lastName: true },
    });

    const createSite = alsoCreateSiteNotification !== false;
    const inAppTitle = siteTitle?.trim() || 'اطلاعیه طبقه';
    const inAppMessage = parameterValue.trim();

    let sent = 0;
    let failed = 0;
    let siteCreated = 0;
    for (const user of users) {
      if (user.phone) {
        try {
          await this.sms.sendByTemplate(user.phone, templateId, [
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

    return { total: users.length, sent, failed, siteCreated };
  }
}
