import {
  BadRequestException,
  Injectable,
  NotFoundException,
  ForbiddenException,
} from '@nestjs/common';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';

@Injectable()
export class ChatsService {
  constructor(private prisma: PrismaService) {}

  async initiateChat(userId: string, listingId: string, targetUserId?: string) {
    const listing = await this.prisma.listing.findUnique({
      where: { id: listingId },
    });

    if (!listing) throw new NotFoundException('آگهی یافت نشد');

    // 👈 لاجیک جدید: تعیین نقش‌ها
    let buyerId: string;
    let sellerId: string = listing.authorId;

    if (listing.authorId === userId) {
      // اگر صاحب آگهی چت را باز کرده، باید مشخص باشد با کدام مشتری/پیشنهاد دهنده کار دارد
      if (!targetUserId) {
        throw new BadRequestException('برای شروع چت توسط صاحب آگهی، مشخص کردن مخاطب الزامی است');
      }
      buyerId = targetUserId;
    } else {
      // اگر یک کاربر دیگر چت را باز کرده، او خریدار است
      buyerId = userId;
    }

    if (buyerId === sellerId) {
      throw new BadRequestException('شما نمی‌توانید با خودتان چت کنید');
    }

    let conversation = await this.prisma.conversation.findUnique({
      where: {
        listingId_buyerId: {
          listingId: listingId,
          buyerId: buyerId,
        },
      },
      include: {
        listing: { select: { title: true, thumbnail: true, id: true } },
        buyer: { select: { firstName: true, lastName: true, id: true, avatar: true } },
        seller: { select: { firstName: true, lastName: true, id: true, avatar: true } },
        messages: { orderBy: { createdAt: 'desc' }, take: 1 },
      },
    });

    if (!conversation) {
      conversation = await this.prisma.conversation.create({
        data: {
          listingId,
          buyerId: buyerId,
          sellerId: sellerId,
        },
        include: {
          listing: { select: { title: true, thumbnail: true, id: true } },
          buyer: { select: { firstName: true, lastName: true, id: true, avatar: true } },
          seller: { select: { firstName: true, lastName: true, id: true, avatar: true } },
          messages: true,
        },
      });
    }

    return conversation;
  }

  // بقیه متدها (getMyConversations, getMessages, sendMessage) بدون تغییر باقی بمانند
  async getMyConversations(userId: string, page = 1, pageSize = 30) {
    const take = Math.min(50, Math.max(5, pageSize));
    const skip = Math.max(0, (page - 1) * take);
    return this.prisma.conversation.findMany({
      where: {
        OR: [{ buyerId: userId }, { sellerId: userId }],
      },
      include: {
        listing: { select: { title: true, thumbnail: true, id: true } },
        buyer: { select: { firstName: true, lastName: true, id: true, avatar: true } },
        seller: { select: { firstName: true, lastName: true, id: true, avatar: true } },
        messages: { orderBy: { createdAt: 'desc' }, take: 1 },
      },
      orderBy: { updatedAt: 'desc' },
      skip,
      take,
    });
  }

  /**
   * پیام‌های یک مکالمه رو صفحه‌بندی‌شده برمی‌گردونه. به صورت پیش‌فرض
   * ۱۰۰ پیام آخر. برای بارگیری پیام‌های قدیمی‌تر، از `before` (تاریخ پیام مرزی)
   * استفاده میشه. ترتیب نهایی صعودی (قدیم به جدید) حفظ شده.
   */
  async getMessages(
    chatId: string,
    userId: string,
    options: { limit?: number; before?: string } = {},
  ) {
    const conversation = await this.prisma.conversation.findUnique({
      where: { id: chatId },
    });
    if (!conversation) throw new NotFoundException('مکالمه پیدا نشد');
    if (conversation.buyerId !== userId && conversation.sellerId !== userId) {
      throw new ForbiddenException('شما دسترسی به این مکالمه را ندارید');
    }

    const limit = Math.min(200, Math.max(10, options.limit ?? 100));
    const where: any = { conversationId: chatId };
    if (options.before) {
      const beforeDate = new Date(options.before);
      if (!isNaN(beforeDate.getTime())) {
        where.createdAt = { lt: beforeDate };
      }
    }

    const recent = await this.prisma.message.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      take: limit,
    });
    return recent.reverse();
  }

  async sendMessage(chatId: string, senderId: string, content: string) {
    const normalizedChatId = chatId?.trim();
    const normalizedContent = content?.trim();

    if (!normalizedChatId) {
      throw new BadRequestException('شناسه مکالمه نامعتبر است');
    }
    if (!normalizedContent) {
      throw new BadRequestException('متن پیام نمی‌تواند خالی باشد');
    }

    const conversation = await this.prisma.conversation.findUnique({
      where: { id: normalizedChatId },
    });
    if (!conversation) throw new NotFoundException('مکالمه یافت نشد');
    if (conversation.buyerId !== senderId && conversation.sellerId !== senderId) {
      throw new ForbiddenException('شما عضو این مکالمه نیستید');
    }
    const message = await this.prisma.message.create({
      data: { conversationId: normalizedChatId, senderId: senderId, content: normalizedContent },
    });
    await this.prisma.conversation.update({
      where: { id: normalizedChatId },
      data: { updatedAt: new Date() },
    });
    return message;
  }

  async markConversationRead(chatId: string, userId: string) {
    const conversation = await this.prisma.conversation.findUnique({
      where: { id: chatId },
    });
    if (!conversation) throw new NotFoundException('مکالمه یافت نشد');
    if (conversation.buyerId !== userId && conversation.sellerId !== userId) {
      throw new ForbiddenException('شما عضو این مکالمه نیستید');
    }

    await this.prisma.message.updateMany({
      where: {
        conversationId: chatId,
        senderId: { not: userId },
        isRead: false,
      },
      data: { isRead: true },
    });

    return { ok: true };
  }
}