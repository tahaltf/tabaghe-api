import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import {
  MarketingMediaType,
  MarketingPostStatus,
} from '@prisma/client';
import { PrismaService } from '../../../infrastructure/prisma/prisma.service';
import { InstagramProvider } from '../providers/instagram/instagram.provider';
import { MarketingAccountService } from './marketing-account.service';

@Injectable()
export class MarketingPublishService {
  private readonly logger = new Logger(MarketingPublishService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly accounts: MarketingAccountService,
    private readonly instagram: InstagramProvider,
  ) {}

  listPosts(params?: {
    accountId?: string;
    status?: MarketingPostStatus;
  }) {
    return this.prisma.marketingPost.findMany({
      where: {
        ...(params?.accountId ? { accountId: params.accountId } : {}),
        ...(params?.status ? { status: params.status } : {}),
      },
      orderBy: [{ scheduledAt: 'asc' }, { createdAt: 'desc' }],
      include: {
        account: {
          select: {
            id: true,
            username: true,
            platform: true,
            profilePicture: true,
          },
        },
        mediaAsset: true,
      },
    });
  }

  async getOrThrow(id: string) {
    const post = await this.prisma.marketingPost.findUnique({
      where: { id },
      include: {
        account: true,
        mediaAsset: true,
      },
    });
    if (!post) throw new NotFoundException('پست یافت نشد');
    return post;
  }

  async create(params: {
    accountId: string;
    createdById: string;
    mediaType: MarketingMediaType;
    caption?: string;
    mediaAssetId?: string;
    mediaAssetIds?: string[];
    scheduledAt?: string | null;
    publishNow?: boolean;
  }) {
    await this.accounts.getAccountOrThrow(params.accountId);

    const scheduledAt = params.scheduledAt
      ? new Date(params.scheduledAt)
      : null;
    if (scheduledAt && scheduledAt.getTime() <= Date.now()) {
      throw new BadRequestException('زمان‌بندی باید در آینده باشد');
    }

    let status: MarketingPostStatus = MarketingPostStatus.DRAFT;
    if (params.publishNow) {
      status = MarketingPostStatus.PUBLISHING;
    } else if (scheduledAt) {
      status = MarketingPostStatus.SCHEDULED;
    }

    const post = await this.prisma.marketingPost.create({
      data: {
        accountId: params.accountId,
        mediaType: params.mediaType,
        caption: params.caption || null,
        mediaAssetId: params.mediaAssetId || null,
        mediaAssetIds: params.mediaAssetIds || [],
        scheduledAt,
        status,
        createdById: params.createdById,
      },
      include: { mediaAsset: true, account: true },
    });

    if (params.publishNow) {
      return this.publishPost(post.id);
    }
    return post;
  }

  async updateCaption(id: string, caption: string) {
    const post = await this.getOrThrow(id);
    await this.prisma.marketingPost.update({
      where: { id },
      data: { caption },
    });

    if (
      post.status === MarketingPostStatus.PUBLISHED &&
      post.platformMediaId
    ) {
      const { accessToken } = await this.accounts.getDecryptedToken(
        post.accountId,
      );
      await this.instagram.updateCaption(
        accessToken,
        post.platformMediaId,
        caption,
      );
    }

    return this.getOrThrow(id);
  }

  async cancelSchedule(id: string) {
    const post = await this.getOrThrow(id);
    if (post.status !== MarketingPostStatus.SCHEDULED) {
      throw new BadRequestException('فقط پست‌های زمان‌بندی‌شده قابل لغو هستند');
    }
    return this.prisma.marketingPost.update({
      where: { id },
      data: {
        status: MarketingPostStatus.DRAFT,
        scheduledAt: null,
      },
    });
  }

  async remove(id: string) {
    const post = await this.getOrThrow(id);
    if (post.status === MarketingPostStatus.PUBLISHING) {
      throw new BadRequestException('پست در حال انتشار است');
    }
    await this.prisma.marketingPost.delete({ where: { id } });
    return { ok: true };
  }

  async publishPost(id: string) {
    const post = await this.getOrThrow(id);
    if (
      post.status === MarketingPostStatus.PUBLISHED &&
      post.platformMediaId
    ) {
      return post;
    }

    await this.prisma.marketingPost.update({
      where: { id },
      data: {
        status: MarketingPostStatus.PUBLISHING,
        errorMessage: null,
      },
    });

    try {
      const { accessToken, externalId } =
        await this.accounts.getDecryptedToken(post.accountId);

      const assetIds = [
        ...(post.mediaAssetId ? [post.mediaAssetId] : []),
        ...post.mediaAssetIds.filter((x) => x !== post.mediaAssetId),
      ];
      const assets = assetIds.length
        ? await this.prisma.marketingMediaAsset.findMany({
            where: { id: { in: assetIds } },
          })
        : [];
      const byId = new Map(assets.map((a) => [a.id, a]));
      const ordered = assetIds
        .map((aid) => byId.get(aid))
        .filter(Boolean) as typeof assets;

      if (!ordered.length && post.mediaType !== MarketingMediaType.CAROUSEL) {
        throw new BadRequestException('رسانه‌ای برای انتشار انتخاب نشده');
      }

      const primary = ordered[0];
      const isVideo = primary?.mimeType.startsWith('video/');

      let result;
      if (post.mediaType === MarketingMediaType.CAROUSEL) {
        result = await this.instagram.publish(accessToken, externalId, {
          mediaType: MarketingMediaType.CAROUSEL,
          caption: post.caption,
          childrenUrls: ordered.map((a) => a.publicUrl),
        });
      } else {
        result = await this.instagram.publish(accessToken, externalId, {
          mediaType: post.mediaType,
          caption: post.caption,
          imageUrl: isVideo ? undefined : primary?.publicUrl,
          videoUrl: isVideo ? primary?.publicUrl : undefined,
        });
      }

      return this.prisma.marketingPost.update({
        where: { id },
        data: {
          status: MarketingPostStatus.PUBLISHED,
          platformMediaId: result.platformMediaId,
          containerId: result.containerId,
          publishedAt: new Date(),
          errorMessage: null,
        },
        include: { mediaAsset: true, account: true },
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : 'publish_failed';
      this.logger.error(`Publish failed for ${id}: ${message}`);
      await this.accounts.markError(post.accountId, message);
      return this.prisma.marketingPost.update({
        where: { id },
        data: {
          status: MarketingPostStatus.FAILED,
          errorMessage: message.slice(0, 1000),
        },
        include: { mediaAsset: true, account: true },
      });
    }
  }

  async processDueScheduled(): Promise<number> {
    const due = await this.prisma.marketingPost.findMany({
      where: {
        status: MarketingPostStatus.SCHEDULED,
        scheduledAt: { lte: new Date() },
      },
      take: 10,
      orderBy: { scheduledAt: 'asc' },
    });
    for (const post of due) {
      await this.publishPost(post.id);
    }
    return due.length;
  }
}
