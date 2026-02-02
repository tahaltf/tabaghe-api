import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { WalletService } from '../wallet/wallet.service';
import { QuotaAction, QuotaReason } from '@prisma/client';

@Injectable()
export class PlansService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly walletService: WalletService,
  ) {}

  // تغییر نام برای هماهنگی با Controller
  async getActivePlans() {
    return this.prisma.plan.findMany({
      where: { isActive: true },
      include: { rules: true },
    });
  }

  async buyPlan(userId: string, planId: string) {
    return this.prisma.$transaction(async (tx) => {
      const plan = await tx.plan.findUnique({
        where: { id: planId },
        include: { rules: true },
      });

      if (!plan || !plan.isActive) {
        throw new NotFoundException('پلن مورد نظر یافت نشد یا غیرفعال است');
      }

      // کسر مبلغ از کیف پول
      await this.walletService.payFromAvailable(userId, plan.price, planId, tx);

      const purchase = await tx.userPlanPurchase.create({
        data: {
          userId,
          planId,
          status: 'ACTIVE',
        },
      });

      // اضافه کردن سهمیه به لجر
      // چون فیلد count در لجر نداریم، به تعداد rule.count ردیف ایجاد می‌کنیم
      for (const rule of plan.rules) {
        const quotaEntries = Array.from({ length: rule.count }).map(() => ({
          userId,
          planPurchaseId: purchase.id,
          listingType: rule.type,
          action: QuotaAction.RELEASE, // آزاد کردن سهمیه برای کاربر
          reason: QuotaReason.PLAN,
          note: `خرید پلن: ${plan.title}`,
        }));

        await tx.quotaLedger.createMany({
          data: quotaEntries,
        });
      }

      return purchase;
    });
  }
}
