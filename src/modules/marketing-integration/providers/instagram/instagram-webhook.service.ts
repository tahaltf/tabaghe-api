import { Injectable, Logger } from '@nestjs/common';
import { createHmac, timingSafeEqual } from 'crypto';
import {
  MarketingMessageDirection,
  MarketingPlatform,
} from '@prisma/client';
import { PrismaService } from '../../../../infrastructure/prisma/prisma.service';
import { ServerSecretConfigService } from '../../../../shared/settings/server-secret-config.service';

@Injectable()
export class InstagramWebhookService {
  private readonly logger = new Logger(InstagramWebhookService.name);

  constructor(
    private readonly secrets: ServerSecretConfigService,
    private readonly prisma: PrismaService,
  ) {}

  verifyChallenge(
    mode: string | undefined,
    token: string | undefined,
    challenge: string | undefined,
  ): string | null {
    const expected = this.secrets.get('META_WEBHOOK_VERIFY_TOKEN')?.trim();
    if (
      mode === 'subscribe' &&
      expected &&
      token === expected &&
      challenge
    ) {
      return challenge;
    }
    return null;
  }

  verifySignature(rawBody: Buffer | string, signatureHeader?: string): boolean {
    const secret = this.secrets.get('META_APP_SECRET')?.trim();
    if (!secret || !signatureHeader) return false;
    const expected =
      'sha256=' +
      createHmac('sha256', secret)
        .update(typeof rawBody === 'string' ? rawBody : rawBody)
        .digest('hex');
    try {
      const a = Buffer.from(signatureHeader);
      const b = Buffer.from(expected);
      return a.length === b.length && timingSafeEqual(a, b);
    } catch {
      return false;
    }
  }

  async handlePayload(body: {
    object?: string;
    entry?: Array<{
      id?: string;
      messaging?: Array<{
        sender?: { id?: string };
        recipient?: { id?: string };
        timestamp?: number;
        message?: {
          mid?: string;
          text?: string;
          attachments?: unknown[];
        };
      }>;
      changes?: Array<{
        field?: string;
        value?: Record<string, unknown>;
      }>;
    }>;
  }): Promise<void> {
    if (!body.entry?.length) return;

    for (const entry of body.entry) {
      const igUserId = entry.id;
      if (!igUserId) continue;

      const account = await this.prisma.marketingAccount.findUnique({
        where: {
          platform_externalId: {
            platform: MarketingPlatform.INSTAGRAM,
            externalId: igUserId,
          },
        },
      });
      if (!account) {
        this.logger.debug(`Webhook for unknown IG account ${igUserId}`);
        continue;
      }

      if (entry.messaging?.length) {
        for (const msg of entry.messaging) {
          await this.ingestMessagingEvent(account.id, msg);
        }
      }

      // Instagram messaging sometimes arrives via changes field
      for (const change of entry.changes || []) {
        if (change.field === 'messages' && change.value) {
          const v = change.value as {
            sender?: { id?: string };
            recipient?: { id?: string };
            message?: { mid?: string; text?: string };
            timestamp?: number;
          };
          await this.ingestMessagingEvent(account.id, {
            sender: v.sender,
            recipient: v.recipient,
            timestamp: v.timestamp,
            message: v.message,
          });
        }
      }
    }
  }

  private async ingestMessagingEvent(
    accountId: string,
    msg: {
      sender?: { id?: string };
      recipient?: { id?: string };
      timestamp?: number;
      message?: {
        mid?: string;
        text?: string;
        attachments?: unknown[];
      };
    },
  ): Promise<void> {
    if (!msg.message?.mid && !msg.message?.text) return;

    const account = await this.prisma.marketingAccount.findUnique({
      where: { id: accountId },
    });
    if (!account) return;

    const isOutbound = msg.sender?.id === account.externalId;
    const participantId = isOutbound
      ? msg.recipient?.id
      : msg.sender?.id;
    if (!participantId) return;

    const conversation = await this.prisma.marketingConversation.upsert({
      where: {
        accountId_externalThreadId: {
          accountId,
          externalThreadId: participantId,
        },
      },
      create: {
        accountId,
        externalThreadId: participantId,
        lastMessageAt: msg.timestamp
          ? new Date(msg.timestamp)
          : new Date(),
        unreadCount: isOutbound ? 0 : 1,
      },
      update: {
        lastMessageAt: msg.timestamp
          ? new Date(msg.timestamp)
          : new Date(),
        unreadCount: isOutbound
          ? undefined
          : { increment: 1 },
      },
    });

    const externalMessageId = msg.message?.mid || null;
    if (externalMessageId) {
      const existing = await this.prisma.marketingMessage.findFirst({
        where: { conversationId: conversation.id, externalMessageId },
      });
      if (existing) return;
    }

    await this.prisma.marketingMessage.create({
      data: {
        conversationId: conversation.id,
        externalMessageId,
        direction: isOutbound
          ? MarketingMessageDirection.OUT
          : MarketingMessageDirection.IN,
        text: msg.message?.text || null,
        attachments: msg.message?.attachments
          ? (msg.message.attachments as object)
          : undefined,
        sentAt: msg.timestamp ? new Date(msg.timestamp) : new Date(),
      },
    });
  }
}
