import { OrderStatus, Prisma } from '@prisma/client';

/** هنگام انتقال به COMPLETED، زمان تکمیل را برای نگهداری ویدیو ثبت می‌کند. */
export function enrichOrderUpdateForCompletion(
  data: Prisma.OrderUpdateInput,
): Prisma.OrderUpdateInput {
  if (data.status !== OrderStatus.COMPLETED) return data;
  if (data.completedAt !== undefined && data.completedAt !== null) return data;
  return { ...data, completedAt: new Date() };
}
