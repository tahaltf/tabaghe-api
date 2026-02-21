import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { ListingType } from '@prisma/client';
import Decimal from 'decimal.js';

@Injectable()
export class FeeCalculatorService {
  constructor(private readonly prisma: PrismaService) {}

  async calculateFee(
    listingType: ListingType,
    categoryId: string | null,
    amount: number | string | Decimal,
  ): Promise<Decimal> {
    const targetAmount = new Decimal(amount);

    // پیدا کردن قوانین فعال
    const rules = await this.prisma.feeRule.findMany({
      where: {
        listingType,
        isActive: true,
        OR: [{ categoryId: categoryId }, { categoryId: null }],
        minPrice: { lte: targetAmount.toString() }, // مقایسه رشته‌ای برای دیتابیس
      },
      orderBy: [
        { categoryId: 'desc' }, // اولویت با قوانین اختصاصی دسته‌بندی
        { minPrice: 'desc' },
      ],
    });

    // در صورتی که قانونی ست نشده باشد، برای جلوگیری از توقف سیستم، کارمزد صفر برمی‌گردانیم
    // در پروداکشن واقعی می‌توانید اینجا Throw Exception کنید تا ادمین مجبور به ثبت قانون شود
    if (rules.length === 0) {
      return new Decimal(0);
    }

    // فیلتر کردن بر اساس سقف قیمتی
    const applicableRule = rules.find((rule) => {
      if (!rule.maxPrice) return true;
      return targetAmount.lte(new Decimal(rule.maxPrice));
    }) || rules[0];

    // محاسبه: (مبلغ * درصد) + مبلغ ثابت
    const percentageFee = targetAmount
      .mul(new Decimal(applicableRule.feePercent))
      .div(new Decimal(100));

    return percentageFee.plus(new Decimal(applicableRule.feeFixed));
  }
}