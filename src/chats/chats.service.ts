import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class ChatsService {
  constructor(private prisma: PrismaService) {}

  async initiateChat(userId: string, listingId: string) {
    const listing = await this.prisma.listing.findUnique({
      where: { id: listingId },
    });

    if (!listing) throw new NotFoundException('آگهی یافت نشد');
    if (listing.authorId === userId) {
      throw new BadRequestException('نمیتوانید با خودتان چت کنید');
    }

    let conversation = await this.prisma.conversation.findUnique({
      where: {
        listingId_buyerId: {
          listingId: listingId,
          buyerId: userId,
        },
      },
      include: {
        listing: { select: { title: true, thumbnail: true, id: true } },
        buyer: { select: { firstName: true, lastName: true, id: true } },
        seller: { select: { firstName: true, lastName: true, id: true } },
        messages: {
          orderBy: { createdAt: 'desc' },
          take: 1,
        },
      },
    });

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
          messages: true,
        },
      });
    }

    return conversation;
  }

  async getMyConversations(userId: string) {
    if(!userId) throw new BadRequestException('User ID is missing');

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
          take: 1,
        },
      },
      orderBy: { updatedAt: 'desc' },
    });
  }

  // --- متد مشکل دار ---
  async getMessages(chatId: string, userId: string) {
    const conversation = await this.prisma.conversation.findUnique({
      where: { id: chatId },
    });

    // لاگ‌های دیباگ (حتما در ترمینال سرور چک کنید)
    console.log('--- Service Debug ---');
    console.log('Request User ID:', userId);
    console.log('Chat Found:', !!conversation);
    if(conversation) {
      console.log('Buyer ID:', conversation.buyerId);
      console.log('Seller ID:', conversation.sellerId);
      console.log('Is Buyer Match?', conversation.buyerId === userId);
      console.log('Is Seller Match?', conversation.sellerId === userId);
    }

    if (!conversation) {
      throw new NotFoundException('مکالمه پیدا نشد');
    }

    if (conversation.buyerId !== userId && conversation.sellerId !== userId) {
      throw new BadRequestException('دسترسی به این مکالمه ندارید');
    }

    return this.prisma.message.findMany({
      where: { conversationId: chatId },
      orderBy: { createdAt: 'asc' },
    });
  }

  async sendMessage(chatId: string, senderId: string, content: string) {
    const conversation = await this.prisma.conversation.findUnique({
      where: { id: chatId },
    });

    if (!conversation) throw new NotFoundException('مکالمه یافت نشد');

    const message = await this.prisma.message.create({
      data: {
        conversationId: chatId,
        senderId: senderId,
        content: content,
      },
    });

    await this.prisma.conversation.update({
      where: { id: chatId },
      data: { updatedAt: new Date() },
    });

    return message;
  }
}