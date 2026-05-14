import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { CreateReviewDto } from './dto/create-review.dto';
import { OrderStatus } from '@prisma/client';

@Injectable()
export class ReviewsService {
  constructor(private readonly prisma: PrismaService) {}

  async createReview(userId: string, dto: CreateReviewDto) {
    return this.prisma.$transaction(async (tx) => {
      // ۱. بررسی وجود سفارش و وضعیت آن
      const order = await tx.order.findUnique({
        where: { id: dto.orderId },
      });

      if (!order) throw new NotFoundException('سفارش یافت نشد');

      // فقط برای سفارشات تحویل داده شده (موفق) امکان ثبت نظر وجود دارد
      if (order.status !== OrderStatus.DELIVERED) {
        throw new BadRequestException(
          'فقط برای سفارش‌های تحویل‌داده‌شده می‌توانید نظر ثبت کنید',
        );
      }

      // ۲. تشخیص اینکه کاربر فرستنده کیست و گیرنده نظر کیست
      let revieweeId: string;
      if (order.buyerId === userId) {
        revieweeId = order.sellerId; // خریدار دارد به فروشنده امتیاز می‌دهد
      } else if (order.sellerId === userId) {
        revieweeId = order.buyerId; // فروشنده دارد به خریدار امتیاز می‌دهد
      } else {
        throw new ForbiddenException('شما طرف حساب این معامله نیستید');
      }

      // ۳. جلوگیری از ثبت نظر تکراری
      const existingReview = await tx.review.findUnique({
        where: {
          orderId_reviewerId: {
            orderId: order.id,
            reviewerId: userId,
          },
        },
      });

      if (existingReview) {
        throw new BadRequestException(
          'شما قبلاً برای این معامله نظر خود را ثبت کرده‌اید',
        );
      }

      // ۴. ثبت نظر جدید
      const review = await tx.review.create({
        data: {
          orderId: order.id,
          reviewerId: userId,
          revieweeId: revieweeId,
          rating: dto.rating,
          comment: dto.comment,
        },
      });

      // ۵. محاسبه میانگین جدید و آپدیت پروفایل کاربر (Reviewee)
      const aggregates = await tx.review.aggregate({
        where: { revieweeId: revieweeId },
        _avg: { rating: true },
      });

      const newAverage = aggregates._avg.rating
        ? Number(aggregates._avg.rating.toFixed(1))
        : dto.rating;

      await tx.user.update({
        where: { id: revieweeId },
        data: { rating: newAverage },
      });

      return review;
    });
  }

  // دریافت نظراتی که یک کاربر دریافت کرده (برای نمایش در پروفایل عمومی)
  // صفحه‌بندی الزامی شده تا endpoint عمومی قابل scrape نباشه.
  async getUserReviews(userId: string, page = 1, pageSize = 10) {
    const take = Math.min(30, Math.max(5, pageSize));
    const skip = Math.max(0, (page - 1) * take);
    const [items, total] = await Promise.all([
      this.prisma.review.findMany({
        where: { revieweeId: userId },
        include: {
          reviewer: {
            select: { firstName: true, lastName: true, avatar: true },
          },
          order: {
            include: { listing: { select: { title: true, type: true } } },
          },
        },
        orderBy: { createdAt: 'desc' },
        skip,
        take,
      }),
      this.prisma.review.count({ where: { revieweeId: userId } }),
    ]);
    return {
      items,
      pagination: {
        page,
        pageSize: take,
        total,
        totalPages: take > 0 ? Math.ceil(total / take) : 0,
      },
    };
  }

  // نظراتی که من ثبت کرده‌ام (برای مدیریت در پنل کاربری)
  async getMyGivenReviews(userId: string) {
    return this.prisma.review.findMany({
      where: { reviewerId: userId },
      include: {
        reviewee: { select: { firstName: true, lastName: true, avatar: true } },
        order: {
          include: { listing: { select: { title: true } } },
        },
      },
      orderBy: { createdAt: 'desc' },
    });
  }
}
