import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { Interval } from '@nestjs/schedule';
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
import { buildPaginationMeta } from '../../../shared/contracts/pagination';
import { OpenAiImageProvider } from '../providers/openai-image.provider';
import { OpenAiTextProvider } from '../providers/openai-text.provider';
import { buildStoryImagePrompt } from '../utils/story-prompt.builder';
import {
  assertUserPromptLength,
  computeStoryTokenCost,
} from '../utils/story-token-cost.util';
import { AiContentSettingsService } from './ai-content-settings.service';
import { AiTokenService } from './ai-token.service';

export type StoryJobAccepted = {
  id: string;
  status: 'PROCESSING';
  tokensReserved: number;
  styleId: string;
  includeCaption: boolean;
};

const STUCK_PROCESSING_MS = 10 * 60 * 1000;

@Injectable()
export class AiContentStoryService {
  private readonly logger = new Logger(AiContentStoryService.name);
  private sweeping = false;

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

  /**
   * شروع سریع تولید استوری: رکورد PROCESSING + رزرو توکن، سپس کار در پس‌زمینه.
   * کلاینت با GET /requests/:id وضعیت را poll می‌کند.
   */
  async enqueueStory(
    userId: string,
    listingId: string,
    styleId: string,
    userPrompt?: string,
    parentRequestId?: string,
    includeCaption = false,
  ): Promise<StoryJobAccepted> {
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

    let normalizedPrompt = '';
    try {
      normalizedPrompt = assertUserPromptLength(userPrompt);
    } catch (err) {
      throw new BadRequestException(
        String((err as Error)?.message ?? 'توضیح نامعتبر است'),
      );
    }

    const baseCost = await this.settings.getStoryTokenCost();
    const tokenCost = computeStoryTokenCost(baseCost, normalizedPrompt);
    const balance = await this.tokens.getBalance(userId);
    if (balance.totalAvailable < tokenCost) {
      throw new BadRequestException(
        `توکن کافی ندارید. این ساخت به ${tokenCost} توکن نیاز دارد.`,
      );
    }

    const request = await this.prisma.aiContentRequest.create({
      data: {
        userId,
        listingId,
        type: AiContentType.STORY,
        styleId: style.id,
        userPrompt: normalizedPrompt || null,
        status: AiContentRequestStatus.PROCESSING,
        parentRequestId: parentRequestId ?? null,
        /** تا قبل از SUCCESS = مقدار رزروشده برای sweep/release */
        tokensCharged: tokenCost,
      },
    });

    await this.tokens.reserve(userId, tokenCost, request.id);

    const jobInput = {
      requestId: request.id,
      userId,
      listingId,
      styleId: style.id,
      stylePromptAddon: style.promptAddon,
      styleLabel: style.label,
      userPrompt: normalizedPrompt || undefined,
      includeCaption,
      tokenCost,
      productImagePath,
      listingTitle: listing.title,
      listingDescription: this.toPlainDescription(listing.description),
      priceLabel: this.formatPrice(listing.direct),
    };

    setImmediate(() => {
      void this.runStoryJob(jobInput).catch((err) => {
        this.logger.error(
          `runStoryJob unhandled request=${request.id}: ${String((err as Error)?.message ?? err)}`,
          err instanceof Error ? err.stack : undefined,
        );
      });
    });

    return {
      id: request.id,
      status: 'PROCESSING',
      tokensReserved: tokenCost,
      styleId: style.id,
      includeCaption,
    };
  }

  /** سازگاری با نام قبلی — همان enqueue */
  generateStory(
    userId: string,
    listingId: string,
    styleId: string,
    userPrompt?: string,
    parentRequestId?: string,
    includeCaption = false,
  ) {
    return this.enqueueStory(
      userId,
      listingId,
      styleId,
      userPrompt,
      parentRequestId,
      includeCaption,
    );
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

    return this.enqueueStory(
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

    const imageUrl =
      request.status === AiContentRequestStatus.SUCCESS &&
      request.resultImagePath
        ? `/uploads/ai-content/${request.id}.png`
        : null;

    let remainingTokens: number | null = null;
    if (request.status === AiContentRequestStatus.SUCCESS) {
      const balance = await this.tokens.getBalance(userId);
      remainingTokens = balance.totalAvailable;
    }

    return {
      id: request.id,
      status: request.status,
      type: request.type,
      styleId: request.styleId,
      userPrompt: request.userPrompt,
      caption: request.resultCaption,
      resultCaption: request.resultCaption,
      tokensCharged: request.tokensCharged,
      provider: request.provider,
      model: request.model,
      errorMessage: request.errorMessage,
      parentRequestId: request.parentRequestId,
      createdAt: request.createdAt,
      completedAt: request.completedAt,
      listing: request.listing,
      imageUrl,
      remainingTokens,
      includeCaption: Boolean(request.resultCaption),
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
    provider?: string;
    userId?: string;
    q?: string;
  }) {
    const page = Math.max(1, params.page ?? 1);
    const take = Math.min(Math.max(params.limit ?? 20, 1), 50);
    const skip = (page - 1) * take;

    const baseWhere = this.buildGenerationsWhere({
      userId: params.userId,
      q: params.q,
    });
    const where = this.buildGenerationsWhere({
      status: params.status,
      provider: params.provider,
      userId: params.userId,
      q: params.q,
    });

    const startOfDay = new Date();
    startOfDay.setHours(0, 0, 0, 0);

    const [items, total, successCount, failedCount, processingCount, pendingCount, todaySuccess] =
      await Promise.all([
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
        this.prisma.aiContentRequest.count({
          where: { ...baseWhere, status: AiContentRequestStatus.SUCCESS },
        }),
        this.prisma.aiContentRequest.count({
          where: { ...baseWhere, status: AiContentRequestStatus.FAILED },
        }),
        this.prisma.aiContentRequest.count({
          where: { ...baseWhere, status: AiContentRequestStatus.PROCESSING },
        }),
        this.prisma.aiContentRequest.count({
          where: { ...baseWhere, status: AiContentRequestStatus.PENDING },
        }),
        this.prisma.aiContentRequest.count({
          where: {
            ...baseWhere,
            status: AiContentRequestStatus.SUCCESS,
            createdAt: { gte: startOfDay },
          },
        }),
      ]);

    const allMatching = await this.prisma.aiContentRequest.count({ where: baseWhere });

    return {
      items: items.map((item) => {
        const completedAt = item.completedAt;
        const durationMs =
          completedAt != null
            ? Math.max(0, completedAt.getTime() - item.createdAt.getTime())
            : null;
        return {
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
          durationMs,
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
        };
      }),
      meta: buildPaginationMeta(page, take, total),
      summary: {
        total: allMatching,
        success: successCount,
        failed: failedCount,
        processing: processingCount,
        pending: pendingCount,
        todaySuccess,
      },
    };
  }

  private buildGenerationsWhere(params: {
    status?: string;
    provider?: string;
    userId?: string;
    q?: string;
  }): Prisma.AiContentRequestWhereInput {
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
    if (params.provider?.trim()) {
      where.provider = params.provider.trim();
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
    return where;
  }

  /** هر ۲ دقیقه: PROCESSINGهای گیرکرده را FAILED کن و توکن رزرو را آزاد کن */
  @Interval(120_000)
  async sweepStuckProcessing(): Promise<void> {
    if (this.sweeping) return;
    this.sweeping = true;
    try {
      const cutoff = new Date(Date.now() - STUCK_PROCESSING_MS);
      const stuck = await this.prisma.aiContentRequest.findMany({
        where: {
          status: AiContentRequestStatus.PROCESSING,
          createdAt: { lt: cutoff },
        },
        select: { id: true, userId: true, tokensCharged: true },
        take: 50,
      });

      for (const row of stuck) {
        const tokenCost = Math.max(1, row.tokensCharged || 1);
        try {
          await this.tokens.release(row.userId, tokenCost, row.id);
        } catch (err) {
          this.logger.warn(
            `sweep release failed ${row.id}: ${String((err as Error)?.message ?? err)}`,
          );
        }
        try {
          await this.prisma.aiContentRequest.update({
            where: { id: row.id },
            data: {
              status: AiContentRequestStatus.FAILED,
              errorMessage: 'زمان پردازش به پایان رسید. لطفاً دوباره تلاش کنید.',
              completedAt: new Date(),
            },
          });
          this.logger.warn(`swept stuck PROCESSING request=${row.id}`);
        } catch (err) {
          this.logger.warn(
            `sweep mark FAILED failed ${row.id}: ${String((err as Error)?.message ?? err)}`,
          );
        }
      }
    } catch (err) {
      this.logger.warn(
        `sweepStuckProcessing failed: ${String((err as Error)?.message ?? err)}`,
      );
    } finally {
      this.sweeping = false;
    }
  }

  private async runStoryJob(job: {
    requestId: string;
    userId: string;
    listingId: string;
    styleId: string;
    stylePromptAddon: string;
    styleLabel: string;
    userPrompt?: string;
    includeCaption: boolean;
    tokenCost: number;
    productImagePath: string;
    listingTitle: string;
    listingDescription: string;
    priceLabel: string | null;
  }): Promise<void> {
    let imagePrompt: string | null = null;

    try {
      const stillProcessing = await this.prisma.aiContentRequest.findFirst({
        where: {
          id: job.requestId,
          status: AiContentRequestStatus.PROCESSING,
        },
        select: { id: true },
      });
      if (!stillProcessing) {
        this.logger.warn(
          `runStoryJob skipped request=${job.requestId} (not PROCESSING)`,
        );
        return;
      }

      const [systemPrompt, constraints] = await Promise.all([
        this.settings.getStorySystemPrompt(),
        this.settings.getStoryConstraints(),
      ]);

      const input = {
        listingTitle: job.listingTitle,
        listingDescription: job.listingDescription,
        priceLabel: job.priceLabel,
        userPrompt: job.userPrompt,
        systemPrompt,
        constraints,
        stylePromptAddon: job.stylePromptAddon,
        styleLabel: job.styleLabel,
      };

      imagePrompt = buildStoryImagePrompt(input);

      const caption = job.includeCaption
        ? await this.textProvider.generateStoryCaption(input)
        : '';
      const fileName = `${job.requestId}.png`;
      const imageResult = await this.imageProvider.generateStoryImage({
        input,
        productImagePath: job.productImagePath,
        caption,
        outputFileName: fileName,
      });

      const localPath = this.imageProvider.saveToUploads(
        fileName,
        imageResult.buffer,
      );

      await this.prisma.$transaction(async (tx) => {
        await this.tokens.commit(
          job.userId,
          job.tokenCost,
          job.requestId,
          tx,
        );
        await tx.aiContentRequest.update({
          where: { id: job.requestId },
          data: {
            status: AiContentRequestStatus.SUCCESS,
            resultImagePath: localPath,
            resultCaption: caption || null,
            imagePrompt,
            tokensCharged: job.tokenCost,
            provider: imageResult.provider,
            model: imageResult.model,
            completedAt: new Date(),
          },
        });
      });
    } catch (err) {
      const message = String((err as Error)?.message ?? err);
      this.logger.error(
        `runStoryJob failed request=${job.requestId}: ${message}`,
        err instanceof Error ? err.stack : undefined,
      );

      try {
        await this.tokens.release(job.userId, job.tokenCost, job.requestId);
      } catch (releaseErr) {
        this.logger.warn(
          `token release failed for ${job.requestId}: ${String((releaseErr as Error)?.message ?? releaseErr)}`,
        );
      }

      const friendly =
        message.includes('تصویر') || message.includes('ساخت تصویر')
          ? message
          : 'ساخت استوری ناموفق بود. لطفاً دوباره تلاش کنید یا محصول دیگری انتخاب کنید.';

      try {
        await this.prisma.aiContentRequest.update({
          where: { id: job.requestId },
          data: {
            status: AiContentRequestStatus.FAILED,
            imagePrompt: imagePrompt ?? undefined,
            errorMessage: friendly.slice(0, 2000),
            completedAt: new Date(),
          },
        });
      } catch (updateErr) {
        this.logger.warn(
          `failed to mark request ${job.requestId} as FAILED: ${String((updateErr as Error)?.message ?? updateErr)}`,
        );
      }
    }
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
