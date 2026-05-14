// listings/entities/bid.entity.ts (نمای کلی)
export class Bid {
  id: string;
  listingId: string;
  userId: string;
  userName: string; // برای نمایش سریع‌تر در فرانت
  amount: number;
  createdAt: Date;
}
