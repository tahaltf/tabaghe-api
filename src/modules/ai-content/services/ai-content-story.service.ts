import {
  BadRequestException,
  Injectable,
  Logger,
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
import { buildStoryImagePrompt } from '../utils/story-prompt.builder';
import { AiContentSettingsService } from './ai-content-settings.service';
import { AiTokenService } from './ai-token.service';

@Injectable()
export class AiContentStoryService {
  private readonly logger = new Logger(AiContentStoryService.name);

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
          direct: {
            select: { price: true, compareAtPrice: true, salePrice: true },
          },
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
      meta: buildPaginationMeta(page, take, total),
    };
  }

  async generateStory(
    userId: string,
    listingId: string,
    styleId: string,
    userPrompt?: string,
    parentRequestId?: string,
    includeCaption = false,
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

    let imagePrompt: string | null = null;

    try {
      const [systemPrompt, constraints] = await Promise.all([
        this.settings.getStorySystemPrompt(),
        this.settings.getStoryConstraints(),
      ]);

      const input = {
        listingTitle: listing.title,
        listingDescription: this.toPlainDescription(listing.description),
        priceLabel: this.formatPrice(listing.direct),
        userPrompt,
        systemPrompt,
        constraints,
        stylePromptAddon: style.promptAddon,
        styleLabel: style.label,
      };

      imagePrompt = buildStoryImagePrompt(input);

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
            imagePrompt,
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
      const message = String((err as Error)?.message ?? err);
      this.logger.error(
        `generateStory failed request=${request.id}: ${message}`,
        err instanceof Error ? err.stack : undefined,
      );

      try {
        await this.tokens.release(userId, tokenCost, request.id);
      } catch (releaseErr) {
        this.logger.warn(
          `token release failed for ${request.id}: ${String((releaseErr as Error)?.message ?? releaseErr)}`,
        );
      }

      try {
        await this.prisma.aiContentRequest.update({
          where: { id: request.id },
          data: {
            status: AiContentRequestStatus.FAILED,
            imagePrompt: imagePrompt ?? undefined,
            errorMessage: message.slice(0, 2000),
            completedAt: new Date(),
          },
        });
      } catch (updateErr) {
        this.logger.warn(
          `failed to mark request ${request.id} as FAILED: ${String((updateErr as Error)?.message ?? updateErr)}`,
        );
      }

      if (
        err instanceof BadRequestException ||
        err instanceof NotFoundException
      ) {
        throw err;
      }

      throw new BadRequestException(
        message.includes('تصویر') || message.includes('ساخت تصویر')
          ? message
          : 'ساخت استوری ناموفق بود. لطفاً دوباره تلاش کنید یا محصول دیگری انتخاب کنید.',
      );
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
        request.status === AiContentRequestStatus.SUCCESS &&
        request.resultImagePath
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
      meta: buildPaginationMeta(page, take, total),
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

  /** لیست سراسری تولیدهای AI برای مانیتور ادمین */
  async listGenerations(params: {
    page?: number;
    limit?: number;
    status?: string;
    userId?: string;
    q?: string;
  }) {
    const page = Math.max(1, params.page ?? 1);
    const take = Math.min(Math.max(params.limit ?? 20, 1), 50);
    const skip = (page - 1) * take;

    const where: Prisma.AiContentRequestWhereInput = {};
    if (params.status) {
      const status = params.status.toUpperCase();
      if (
        Object.values(AiContentRequestStatus).includes(
          status as AiContentRequestStatus,
        )
      ) {
        where.status = status as AiContentRequestStatus;
      }
    }
    if (params.userId?.trim()) {
      where.userId = params.userId.trim();
    }
    const q = params.q?.trim();
    if (q) {
      where.OR = [
        { userPrompt: { contains: q, mode: 'insensitive' } },
        { imagePrompt: { contains: q, mode: 'insensitive' } },
        { errorMessage: { contains: q, mode: 'insensitive' } },
        { listing: { title: { contains: q, mode: 'insensitive' } } },
        {
          user: {
            OR: [
              { phone: { contains: q } },
              { displayName: { contains: q, mode: 'insensitive' } },
              { firstName: { contains: q, mode: 'insensitive' } },
              { lastName: { contains: q, mode: 'insensitive' } },
            ],
          },
        },
      ];
    }

    const [items, total] = await Promise.all([
      this.prisma.aiContentRequest.findMany({
        where,
        skip,
        take,
        orderBy: { createdAt: 'desc' },
        include: {
          listing: { select: { id: true, title: true } },
          user: {
            select: {
              id: true,
              phone: true,
              displayName: true,
              firstName: true,
              lastName: true,
            },
          },
        },
      }),
      this.prisma.aiContentRequest.count({ where }),
    ]);

    return {
      items: items.map((item) => ({
        id: item.id,
        type: item.type,
        status: item.status,
        styleId: item.styleId,
        userPrompt: item.userPrompt,
        imagePrompt: item.imagePrompt,
        resultCaption: item.resultCaption,
        tokensCharged: item.tokensCharged,
        provider: item.provider,
        model: item.model,
        errorMessage: item.errorMessage,
        createdAt: item.createdAt,
        completedAt: item.completedAt,
        listing: item.listing,
        user: {
          id: item.user.id,
          phone: item.user.phone,
          name:
            item.user.displayName?.trim() ||
            [item.user.firstName, item.user.lastName]
              .filter(Boolean)
              .join(' ')
              .trim() ||
            null,
        },
        imageUrl:
          item.status === AiContentRequestStatus.SUCCESS
            ? `/uploads/ai-content/${item.id}.png`
            : null,
      })),
      meta: buildPaginationMeta(page, take, total),
    };
  }

  private async assertDailyLimit(userId: string): Promise<void> {
    const limit = await this.settings.getDailyLimit();
    const start = new Date();
    start.setHours(0, 0, 0, 0);

    const count = await this.prisma.aiContentRequest.count({
      where: {
        userId,
        createdAt: { gte: start },
        status: {
          in: [
            AiContentRequestStatus.SUCCESS,
            AiContentRequestStatus.PROCESSING,
          ],
        },
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
    return join(LISTING_UPLOAD_DIR, basenameOnly(normalized)).replace(
      /\\/g,
      '/',
    );
  }

  private toPlainDescription(raw: string | null | undefined): string {
    return String(raw ?? '')
      .replace(/<[^>]*>/g, ' ')
      .replace(/&nbsp;/gi, ' ')
      .replace(/&amp;/gi, '&')
      .replace(/&lt;/gi, '<')
      .replace(/&gt;/gi, '>')
      .replace(/&quot;/gi, '"')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, 1200);
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
