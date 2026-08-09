import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  AiContentRequestStatus,
  AiContentType,
  ListingStatus,
  Prisma,
} from '@prisma/client';
import { existsSync } from 'fs';
import { join } from 'path';
import { LISTING_UPLOAD_DIR } from '../../../common/upload/listing-image-process.util';
import { PrismaService } from '../../../infrastructure/prisma/prisma.service';
import {
  buildPaginationMeta,
} from '../../../shared/contracts/pagination';
import { OpenAiImageProvider } from '../providers/openai-image.provider';
import { OpenAiTextProvider } from '../providers/openai-text.provider';
import { AiContentSettingsService } from './ai-content-settings.service';
import { AiTokenService } from './ai-token.service';

@Injectable()
export class AiContentStoryService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly settings: AiContentSettingsService,
    private readonly tokens: AiTokenService,
    private readonly textProvider: OpenAiTextProvider,
    private readonly imageProvider: OpenAiImageProvider,
  ) {}

  async listEligibleListings(userId: string, page = 1, limit = 20) {
    const take = Math.min(Math.max(limit, 1), 50);
    const skip = (Math.max(page, 1) - 1) * take;

    const where: Prisma.ListingWhereInput = {
      authorId: userId,
      status: ListingStatus.APPROVED,
      gallery: { isEmpty: false },
    };

    const [items, total] = await Promise.all([
      this.prisma.listing.findMany({
        where,
        skip,
        take,
        orderBy: { createdAt: 'desc' },
        select: {
          id: true,
          title: true,
          description: true,
          thumbnail: true,
          gallery: true,
          direct: { select: { price: true, compareAtPrice: true, salePrice: true } },
        },
      }),
      this.prisma.listing.count({ where }),
    ]);

    return {
      items: items.map((item) => ({
        id: item.id,
        title: item.title,
        description: item.description,
        thumbnail: item.thumbnail ?? item.gallery[0] ?? null,
        gallery: item.gallery,
        priceLabel: this.formatPrice(item.direct),
      })),
      meta: buildPaginationMeta(total, page, take),
    };
  }

  async generateStory(
    userId: string,
    listingId: string,
    styleId: string,
    userPrompt?: string,
    parentRequestId?: string,
    includeCaption = true,
  ) {
    if (!(await this.settings.isEnabledForUser(userId))) {
      throw new BadRequestException('تولید محتوا برای حساب شما فعال نیست');
    }

    await this.assertDailyLimit(userId);

    const style = await this.settings.getStyle(styleId);

    const listing = await this.prisma.listing.findFirst({
      where: {
        id: listingId,
        authorId: userId,
        status: ListingStatus.APPROVED,
      },
      include: { direct: true },
    });

    if (!listing || listing.gallery.length === 0) {
      throw new NotFoundException(
        'آگهی یافت نشد یا برای تولید محتوا مناسب نیست',
      );
    }

    const productImagePath = this.resolveListingImagePath(
      listing.thumbnail ?? listing.gallery[0],
    );
    if (!existsSync(productImagePath)) {
      throw new BadRequestException('تصویر محصول در دسترس نیست');
    }

    const tokenCost = await this.settings.getStoryTokenCost();
    const balance = await this.tokens.getBalance(userId);
    if (balance.totalAvailable < tokenCost) {
      throw new BadRequestException('توکن کافی برای تولید استوری ندارید');
    }

    const request = await this.prisma.aiContentRequest.create({
      data: {
        userId,
        listingId,
        type: AiContentType.STORY,
        styleId: style.id,
        userPrompt: userPrompt?.trim() || null,
        status: AiContentRequestStatus.PROCESSING,
        parentRequestId: parentRequestId ?? null,
      },
    });

    await this.tokens.reserve(userId, tokenCost, request.id);

    try {
      const [systemPrompt, constraints] = await Promise.all([
        this.settings.getStorySystemPrompt(),
        this.settings.getStoryConstraints(),
      ]);

      const input = {
        listingTitle: listing.title,
        listingDescription: listing.description,
        priceLabel: this.formatPrice(listing.direct),
        userPrompt,
        systemPrompt,
        constraints,
        stylePromptAddon: style.promptAddon,
        styleLabel: style.label,
      };

      const caption = includeCaption
        ? await this.textProvider.generateStoryCaption(input)
        : '';
      const fileName = `${request.id}.png`;
      const imageResult = await this.imageProvider.generateStoryImage({
        input,
        productImagePath,
        caption,
        outputFileName: fileName,
      });

      const localPath = this.imageProvider.saveToUploads(
        fileName,
        imageResult.buffer,
      );
      const publicImageUrl = this.imageProvider.publicUrlForFile(fileName);

      await this.prisma.$transaction(async (tx) => {
        await this.tokens.commit(userId, tokenCost, request.id, tx);
        await tx.aiContentRequest.update({
          where: { id: request.id },
          data: {
            status: AiContentRequestStatus.SUCCESS,
            resultImagePath: localPath,
            resultCaption: caption || null,
            tokensCharged: tokenCost,
            provider: imageResult.provider,
            model: imageResult.model,
            completedAt: new Date(),
          },
        });
      });

      const remaining = await this.tokens.getBalance(userId);
      return {
        id: request.id,
        imageUrl: publicImageUrl,
        caption: caption || null,
        includeCaption,
        styleId: style.id,
        tokensCharged: tokenCost,
        remainingTokens: remaining.totalAvailable,
        provider: imageResult.provider,
      };
    } catch (err) {
      await this.tokens.release(userId, tokenCost, request.id);
      await this.prisma.aiContentRequest.update({
        where: { id: request.id },
        data: {
          status: AiContentRequestStatus.FAILED,
          errorMessage: String((err as Error).message ?? err),
          completedAt: new Date(),
        },
      });
      throw err;
    }
  }

  async regenerate(
    userId: string,
    requestId: string,
    userPrompt?: string,
    styleId?: string,
    includeCaption?: boolean,
  ) {
    const original = await this.prisma.aiContentRequest.findFirst({
      where: { id: requestId, userId },
    });
    if (!original) {
      throw new NotFoundException('درخواست یافت نشد');
    }
    if (original.type !== AiContentType.STORY) {
      throw new BadRequestException('این درخواست قابل بازتولید نیست');
    }

    const resolvedStyleId = styleId?.trim() || original.styleId;
    if (!resolvedStyleId) {
      throw new BadRequestException('سبک تولید محتوا را انتخاب کنید');
    }

    const wantCaption =
      includeCaption !== undefined
        ? includeCaption
        : Boolean(original.resultCaption);

    return this.generateStory(
      userId,
      original.listingId,
      resolvedStyleId,
      userPrompt ?? original.userPrompt ?? undefined,
      original.id,
      wantCaption,
    );
  }

  async getRequest(userId: string, requestId: string) {
    const request = await this.prisma.aiContentRequest.findFirst({
      where: { id: requestId, userId },
      include: {
        listing: { select: { id: true, title: true } },
      },
    });
    if (!request) throw new NotFoundException('درخواست یافت نشد');
    return {
      ...request,
      imageUrl:
        request.status === AiContentRequestStatus.SUCCESS && request.resultImagePath
          ? `/uploads/ai-content/${request.id}.png`
          : null,
    };
  }

  async listRequests(userId: string, page = 1, limit = 20) {
    const take = Math.min(Math.max(limit, 1), 50);
    const skip = (Math.max(page, 1) - 1) * take;

    const [items, total] = await Promise.all([
      this.prisma.aiContentRequest.findMany({
        where: { userId },
        skip,
        take,
        orderBy: { createdAt: 'desc' },
        include: { listing: { select: { id: true, title: true } } },
      }),
      this.prisma.aiContentRequest.count({ where: { userId } }),
    ]);

    return {
      items: items.map((item) => ({
        ...item,
        imageUrl:
          item.status === AiContentRequestStatus.SUCCESS && item.resultImagePath
            ? `/uploads/ai-content/${item.id}.png`
            : null,
      })),
      meta: buildPaginationMeta(total, page, take),
    };
  }

  async downloadRequest(userId: string, requestId: string) {
    const request = await this.prisma.aiContentRequest.findFirst({
      where: { id: requestId, userId },
    });
    if (!request?.resultImagePath || !existsSync(request.resultImagePath)) {
      throw new NotFoundException('فایل یافت نشد');
    }
    return {
      stream: this.imageProvider.streamFile(request.resultImagePath),
      fileName: `${requestId}.png`,
    };
  }

  async listUserActivity(userId: string, page = 1, limit = 30) {
    return this.listRequests(userId, page, limit);
  }

  private async assertDailyLimit(userId: string): Promise<void> {
    const limit = await this.settings.getDailyLimit();
    const start = new Date();
    start.setHours(0, 0, 0, 0);

    const count = await this.prisma.aiContentRequest.count({
      where: {
        userId,
        createdAt: { gte: start },
        status: { in: [AiContentRequestStatus.SUCCESS, AiContentRequestStatus.PROCESSING] },
      },
    });

    if (count >= limit) {
      throw new BadRequestException(
        'به سقف تولید روزانه رسیده‌اید. فردا دوباره تلاش کنید.',
      );
    }
  }

  private resolveListingImagePath(fileName: string): string {
    const normalized = fileName.replace(/^\/+/, '').replace(/\\/g, '/');
    if (normalized.startsWith('uploads/')) {
      return join('.', normalized).replace(/\\/g, '/');
    }
    return join(LISTING_UPLOAD_DIR, basenameOnly(normalized)).replace(/\\/g, '/');
  }

  private formatPrice(
    direct?: {
      price: Prisma.Decimal;
      salePrice?: Prisma.Decimal | null;
      compareAtPrice?: Prisma.Decimal | null;
    } | null,
  ): string | null {
    if (!direct) return null;
    const effective = direct.salePrice ?? direct.price;
    const n = Number(effective);
    if (!Number.isFinite(n) || n <= 0) return null;
    return `${n.toLocaleString('fa-IR')} تومان`;
  }
}

function basenameOnly(value: string): string {
  const parts = value.split('/');
  return parts[parts.length - 1] || value;
}
