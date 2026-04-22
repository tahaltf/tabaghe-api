import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../../infrastructure/prisma/prisma.service';
import { SmsService } from '../../sms/sms.service';

@Injectable()
export class AdminSmsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly sms: SmsService,
  ) {}

  async broadcast(params: {
    templateId: number;
    parameterName: string;
    parameterValue: string;
    userIds?: string[];
  }) {
    const { templateId, parameterName, parameterValue, userIds } = params;
    const users = await this.prisma.user.findMany({
      where: userIds?.length ? { id: { in: userIds } } : {},
      select: { id: true, phone: true },
    });

    let sent = 0;
    let failed = 0;
    for (const user of users) {
      if (!user.phone) {
        failed++;
        continue;
      }
      try {
        await this.sms.sendByTemplate(user.phone, templateId, [
          { name: parameterName, value: parameterValue },
        ]);
        sent++;
      } catch {
        failed++;
      }
    }

    return { total: users.length, sent, failed };
  }
}
