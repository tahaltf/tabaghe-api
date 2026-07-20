import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { MarketingMessageDirection } from '@prisma/client';
import { PrismaService } from '../../../infrastructure/prisma/prisma.service';
import { InstagramProvider } from '../providers/instagram/instagram.provider';
import { MarketingAccountService } from './marketing-account.service';
import { RedisService } from '../../../infrastructure/cache/redis.service';

@Injectable()
export class MarketingMessagingService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly accounts: MarketingAccountService,
    private readonly instagram: InstagramProvider,
    private readonly redis: RedisService,
  ) {}

  listConversations(accountId?: string) {
    return this.prisma.marketingConversation.findMany({
      where: accountId ? { accountId } : undefined,
      orderBy: { lastMessageAt: 'desc' },
      include: {
        account: {
          select: { id: true, username: true, platform: true },
        },
        messages: {
          orderBy: { sentAt: 'desc' },
          take: 1,
        },
      },
    });
  }

  async getMessages(conversationId: string) {
    const conversation = await this.prisma.marketingConversation.findUnique({
      where: { id: conversationId },
    });
    if (!conversation) {
      throw new NotFoundException('مکالمه یافت نشد');
    }

    await this.prisma.marketingConversation.update({
      where: { id: conversationId },
      data: { unreadCount: 0 },
    });

    const messages = await this.prisma.marketingMessage.findMany({
      where: { conversationId },
      orderBy: { sentAt: 'asc' },
    });

    return { conversation, messages };
  }

  async reply(params: {
    conversationId: string;
    text: string;
    adminUserId: string;
  }) {
    const text = params.text?.trim();
    if (!text) throw new BadRequestException('متن پیام خالی است');

    const conversation = await this.prisma.marketingConversation.findUnique({
      where: { id: params.conversationId },
    });
    if (!conversation) {
      throw new NotFoundException('مکالمه یافت نشد');
    }

    await this.enforceDmRateLimit(conversation.accountId);

    const { accessToken, externalId } =
      await this.accounts.getDecryptedToken(conversation.accountId);

    const sent = await this.instagram.sendDirectMessage(
      accessToken,
      externalId,
      conversation.externalThreadId,
      text,
    );

    const message = await this.prisma.marketingMessage.create({
      data: {
        conversationId: conversation.id,
        externalMessageId: sent.externalMessageId,
        direction: MarketingMessageDirection.OUT,
        text,
        sentByAdminId: params.adminUserId,
        sentAt: new Date(),
      },
    });

    await this.prisma.marketingConversation.update({
      where: { id: conversation.id },
      data: { lastMessageAt: new Date() },
    });

    return message;
  }

  private async enforceDmRateLimit(accountId: string) {
    const key = `marketing:dm:${accountId}:${new Date().toISOString().slice(0, 13)}`;
    const limit = 180; // under Meta ~200/hour
    const current = await this.redis.get(key);
    const count = current ? Number(current) : 0;
    if (count >= limit) {
      throw new BadRequestException(
        'سقف ارسال دایرکت در این ساعت پر شده است. کمی بعد تلاش کنید.',
      );
    }
    await this.redis.set(key, String(count + 1), 3600);
  }
}
