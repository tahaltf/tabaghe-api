import { Injectable } from '@nestjs/common';
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

    if (targetAmount.lte(0)) {
      return new Decimal(0);
    }

    // ۱. اولویت اول: پیدا کردن قوانین خاص از جدول FeeRule
    const rules = await this.prisma.feeRule.findMany({
      where: {
        listingType,
        isActive: true,
        OR: [{ categoryId: categoryId }, { categoryId: null }],
        minPrice: { lte: targetAmount.toString() },
      },
      orderBy: [
        { categoryId: 'desc' }, // اولویت با قوانین اختصاصی دسته‌بندی
        { minPrice: 'desc' },   // اولویت با نزدیک‌ترین کف قیمتی
      ],
    });

    // ۲. اگر قانون خاصی در FeeRule نبود، می‌رویم سراغ درصد پیش‌فرض خود Category (Fallback)
    if (rules.length === 0) {
      if (categoryId) {
        const category = await this.prisma.category.findUnique({
          where: { id: categoryId },
        });

        if (category) {
          // محاسبه بر اساس درصد دسته‌بندی
          const percentageFee = targetAmount
            .mul(new Decimal(category.feePercentage))
            .div(new Decimal(100));

          let totalFee = percentageFee;

          // اعمال سقف کارمزد (Fee Cap) دسته‌بندی
          if (category.feeCap && new Decimal(category.feeCap).gt(0)) {
            const cap = new Decimal(category.feeCap);
            if (totalFee.gt(cap)) {
              totalFee = cap;
            }
          }

          return totalFee.floor();
        }
      }
      // اگر اصلاً دسته‌بندی هم پیدا نشد (حالت استثنا)
      return new Decimal(0);
    }

    // ۳. محاسبه بر اساس قانون پیدا شده در FeeRule (مثل قبل)
    const applicableRule = rules.find((rule) => {
      if (!rule.maxPrice) return true;
      return targetAmount.lte(new Decimal(rule.maxPrice));
    }) || rules[0];

    const percentageFee = targetAmount
      .mul(new Decimal(applicableRule.feePercent)) // دقت کن اینجا feePercent از جدول FeeRule خونده میشه
      .div(new Decimal(100));

    let totalFee = percentageFee.plus(new Decimal(applicableRule.feeFixed));

    if (applicableRule.feeCap && new Decimal(applicableRule.feeCap).gt(0)) {
      const cap = new Decimal(applicableRule.feeCap);
      if (totalFee.gt(cap)) {
        totalFee = cap;
      }
    }

    return totalFee.floor();
  }
}