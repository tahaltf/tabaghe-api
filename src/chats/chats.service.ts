import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class ChatsService {
  constructor(private prisma: PrismaService) {}

  // ۱. شروع چت (وقتی خریدار دکمه چت رو میزنه)
  async initiateChat(userId: string, listingId: string) {
    // اول آگهی رو پیدا کن تا فروشنده مشخص بشه
    const listing = await this.prisma.listing.findUnique({
      where: { id: listingId },
    });

    if (!listing) throw new NotFoundException('آگهی یافت نشد');
    if (listing.authorId === userId) {
      throw new BadRequestException('نمیتوانید با خودتان چت کنید');
    }

    // چک کن آیا قبلاً چتی بین این دو نفر سر این آگهی بوده؟
    let conversation = await this.prisma.conversation.findUnique({
      where: {
        listingId_buyerId: {
          listingId: listingId,
          buyerId: userId,
        },
      },
      // اینجا اطلاعات اضافه رو می‌گیریم که اگر چت موجود بود، برگردونیم
      include: {
        listing: { select: { title: true, thumbnail: true, id: true } },
        buyer: { select: { firstName: true, lastName: true, id: true } },
        seller: { select: { firstName: true, lastName: true, id: true } },
        messages: {
          orderBy: { createdAt: 'desc' },
          take: 1, // آخرین پیام
        },
      },
    });

    // اگر نبود، یکی بساز
    if (!conversation) {
      conversation = await this.prisma.conversation.create({
        data: {
          listingId,
          buyerId: userId,
          sellerId: listing.authorId,
        },
        include: {
          listing: { select: { title: true, thumbnail: true, id: true } },
          buyer: { select: { firstName: true, lastName: true, id: true } },
          seller: { select: { firstName: true, lastName: true, id: true } },
          messages: true, // اولش پیامی نیست
        },
      });
    }

    return conversation;
  }

  // ۲. دریافت لیست تمام مکالمات کاربر (برای سایدبار داشبورد)
  async getMyConversations(userId: string) {
    return this.prisma.conversation.findMany({
      where: {
        OR: [{ buyerId: userId }, { sellerId: userId }],
      },
      include: {
        listing: {
          select: { title: true, thumbnail: true, id: true },
        },
        buyer: { select: { firstName: true, lastName: true, id: true } },
        seller: { select: { firstName: true, lastName: true, id: true } },
        messages: {
          orderBy: { createdAt: 'desc' },
          take: 1, // آخرین پیام برای نمایش در لیست
        },
      },
      orderBy: { updatedAt: 'desc' }, // جدیدترین‌ها بالا باشن
    });
  }

  // ۳. دریافت پیام‌های یک چت خاص
  async getMessages(chatId: string, userId: string) {
    // اول چک کن کاربر دسترسی داره یا نه
    const conversation = await this.prisma.conversation.findUnique({
      where: { id: chatId },
    });

    if (
      !conversation ||
      (conversation.buyerId !== userId && conversation.sellerId !== userId)
    ) {
      throw new BadRequestException('دسترسی به این مکالمه ندارید');
    }

    return this.prisma.message.findMany({
      where: { conversationId: chatId },
      orderBy: { createdAt: 'asc' }, // پیام‌های قدیمی بالا، جدید پایین
    });
  }

  // ۴. ارسال پیام
  async sendMessage(chatId: string, senderId: string, text: string) {
    // مطمئن شو چت وجود داره
    const conversation = await this.prisma.conversation.findUnique({
      where: { id: chatId },
    });

    if (!conversation) throw new NotFoundException('مکالمه یافت نشد');

    // ایجاد پیام
    const message = await this.prisma.message.create({
      data: {
        conversationId: chatId,
        senderId: senderId,
        content: text,
      },
    });

    // آپدیت زمان مکالمه (برای اینکه بیاد صدر لیست)
    await this.prisma.conversation.update({
      where: { id: chatId },
      data: { updatedAt: new Date() },
    });

    return message;
  }
}
