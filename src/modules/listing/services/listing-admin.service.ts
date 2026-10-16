import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import {
  ExchangeOfferStatus,
  Listing,
  ListingImportSource,
  ListingStatus,
  ListingType,
  NotificationType,
  OrderStatus,
  Prisma,
} from '@prisma/client';
import { PrismaService } from '../../../infrastructure/prisma/prisma.service';
import { normalizeMultilineText } from '../../../common/multiline-text.util';
import { sanitizeListingDescription } from '../../../common/sanitize/html-sanitizer.util';
import { QuotaService } from '../../quota/quota.service';
import { RejectListingDto } from '../dto/reject-listing.dto';
import { AdminListingCorrectionsDto } from '../dto/admin-listing-corrections.dto';
import { AdminListingUpdateDto } from '../dto/admin-listing-update.dto';
import { NotificationService } from '../../notification/notification.service';
import { TRADE_REPUTATION_PENALTY_DELTA } from '../../orders/order-reputation.service';
import { ListingExpiryService } from './listing-expiry.service';
import { ListingNotificationBatchService } from '../../../common/notification/listing-notification-batch.service';
import { validateListingSalePricing } from '../../../common/listing/listing-price.util';
import { normalizeVariableListing } from '../../../common/listing/listing-variation.util';
import { syncListingVariations } from '../../../common/listing/listing-variation.persist';

const ADMIN_LISTING_INCLUDE = {
  direct: true,
  variations: {
    orderBy: { sortOrder: 'asc' as const },
  },
  auction: true,
  exchange: true,
  province: { select: { id: true, name: true } },
  city: { select: { id: true, name: true } },
  category: { select: { id: true, title: true } },
  author: {
    select: {
      id: true,
      phone: true,
      firstName: true,
      lastName: true,
      avatar: true,
      isVerified: true,
    },
  },
} satisfies Prisma.ListingInclude;

export type AdminListing = Prisma.ListingGetPayload<{
  include: typeof ADMIN_LISTING_INCLUDE;
}>;

export type BulkListingActionResult = {
  id: string;
  ok: boolean;
  error?: string;
};

export type BulkListingActionResponse = {
  processed: number;
  skipped: number;
  results: BulkListingActionResult[];
};

const EDITABLE_LISTING_STATUSES: ListingStatus[] = [
  ListingStatus.PENDING,
  ListingStatus.APPROVED,
  ListingStatus.REJECTED,
];

const TERMINAL_ORDER_STATUSES: OrderStatus[] = [
  OrderStatus.COMPLETED,
  OrderStatus.CANCELLED,
];

const PRICE_FIELDS: (keyof AdminListingUpdateDto)[] = [
  'price',
  'basePrice',
  'minBidIncrement',
  'buyNowPrice',
];

@Injectable()
export class ListingAdminService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly quotaService: QuotaService,
    private readonly notificationService: NotificationService,
    private readonly listingExpiry: ListingExpiryService,
    private readonly listingNotificationBatch: ListingNotificationBatchService,
  ) {}

  listAll(status?: ListingStatus): Promise<AdminListing[]> {
    return this.prisma.listing.findMany({
      where: status ? { status } : {},
      include: ADMIN_LISTING_INCLUDE,
      orderBy: { createdAt: 'desc' },
    });
  }

  private hasCorrections(dto: AdminListingCorrectionsDto): boolean {
    return (
      dto.title !== undefined ||
      dto.description !== undefined ||
      dto.desiredTitle !== undefined ||
      dto.desiredDescription !== undefined
    );
  }

  async applyCorrections(
    listingId: string,
    dto: AdminListingCorrectionsDto,
  ): Promise<Listing> {
    if (!this.hasCorrections(dto)) {
      throw new BadRequestException('حداقل یک فیلد برای اصلاح ارسال کنید');
    }

    const listing = await this.prisma.listing.findUnique({
      where: { id: listingId },
      include: { exchange: true },
    });
    if (!listing) throw new NotFoundException('آگهی یافت نشد');
    if (listing.status !== ListingStatus.PENDING) {
      throw new BadRequestException(
        'فقط آگهی‌های در انتظار تایید توسط ادمین قابل ویرایش هستند',
      );
    }

    const listingData: Prisma.ListingUpdateInput = {};
    if (dto.title !== undefined) {
      const title = dto.title.trim();
      if (title.length < 2) {
        throw new BadRequestException('عنوان آگهی باید حداقل ۲ کاراکتر باشد');
      }
      listingData.title = title;
    }
    if (dto.description !== undefined) {
      const allowRich =
        listing.importSource === ListingImportSource.WORDPRESS ||
        listing.importSource === ListingImportSource.JSON_FEED;
      listingData.description =
        sanitizeListingDescription(
          normalizeMultilineText(dto.description).trim(),
          allowRich,
        ) || null;
    }

    const exchangeData: Prisma.ListingExchangeUpdateInput = {};
    if (dto.desiredTitle !== undefined) {
      exchangeData.desiredTitle = dto.desiredTitle.trim();
    }
    if (dto.desiredDescription !== undefined) {
      exchangeData.desiredDescription =
        sanitizeListingDescription(
          normalizeMultilineText(dto.desiredDescription).trim(),
          false,
        ) || null;
    }
    const patchExchange = Object.keys(exchangeData).length > 0;

    if (patchExchange && !listing.exchange) {
      throw new BadRequestException(
        'این آگهی فیلد کالای درخواستی معاوضه ندارد',
      );
    }

    return this.prisma.$transaction(async (tx) => {
      if (patchExchange) {
        await tx.listingExchange.update({
          where: { listingId },
          data: exchangeData,
        });
      }
      return tx.listing.update({
        where: { id: listingId },
        data: listingData,
        include: ADMIN_LISTING_INCLUDE,
      });
    });
  }

  private hasAdminUpdateFields(dto: AdminListingUpdateDto): boolean {
    return Object.keys(dto).some(
      (k) => dto[k as keyof AdminListingUpdateDto] !== undefined,
    );
  }

  async applyAdminUpdate(
    listingId: string,
    dto: AdminListingUpdateDto,
  ): Promise<AdminListing> {
    if (!this.hasAdminUpdateFields(dto)) {
      throw new BadRequestException('حداقل یک فیلد برای ویرایش ارسال کنید');
    }

    const listing = await this.prisma.listing.findUnique({
      where: { id: listingId },
      include: { exchange: true, direct: true, auction: true },
    });
    if (!listing) throw new NotFoundException('آگهی یافت نشد');
    if (!EDITABLE_LISTING_STATUSES.includes(listing.status)) {
      throw new BadRequestException('این آگهی در وضعیت فعلی قابل ویرایش نیست');
    }

    const clearingVariable = dto.isVariable === false;
    const syncingVariable =
      !clearingVariable &&
      (dto.isVariable === true ||
        (listing.isVariable &&
          (dto.variations !== undefined ||
            dto.variationAttributes !== undefined)));

    const activeOrder = await this.prisma.order.findFirst({
      where: {
        listingId,
        status: { notIn: TERMINAL_ORDER_STATUSES },
      },
      select: { id: true },
    });
    const touchesPrice =
      PRICE_FIELDS.some((f) => dto[f] !== undefined) ||
      dto.salePrice !== undefined ||
      syncingVariable;
    if (activeOrder && touchesPrice) {
      throw new BadRequestException(
        'به‌دلیل سفارش فعال روی این آگهی، تغییر قیمت امکان‌پذیر نیست. سایر فیلدها را می‌توانید ویرایش کنید.',
      );
    }

    const listingData: Prisma.ListingUpdateInput = {};
    if (dto.title !== undefined) {
      const title = dto.title.trim();
      if (title.length < 2) {
        throw new BadRequestException('عنوان آگهی باید حداقل ۲ کاراکتر باشد');
      }
      listingData.title = title;
    }
    if (dto.description !== undefined) {
      const allowRich =
        listing.importSource === ListingImportSource.WORDPRESS ||
        listing.importSource === ListingImportSource.JSON_FEED;
      listingData.description =
        sanitizeListingDescription(
          normalizeMultilineText(dto.description).trim(),
          allowRich,
        ) || '';
    }
    if (dto.shippingPayer !== undefined) {
      listingData.shippingPayer = dto.shippingPayer;
    }
    if (dto.shippingCostOverride !== undefined) {
      listingData.shippingCostOverride = dto.shippingCostOverride;
    }
    if (dto.condition !== undefined) {
      listingData.condition = dto.condition;
    }
    if (dto.testPeriodDays !== undefined) {
      listingData.testPeriodDays =
        dto.testPeriodDays != null && dto.testPeriodDays > 0
          ? dto.testPeriodDays
          : null;
    }
    const hasVariationPayload =
      dto.isVariable !== undefined ||
      dto.variations !== undefined ||
      dto.variationAttributes !== undefined;

    if (
      listing.isVariable &&
      !hasVariationPayload &&
      (dto.price !== undefined ||
        dto.salePrice !== undefined ||
        dto.compareAtPrice !== undefined ||
        dto.stockQuantity !== undefined)
    ) {
      throw new BadRequestException(
        'برای آگهی متغیر، قیمت و موجودی را از طریق تنوع‌ها ویرایش کنید',
      );
    }

    if (syncingVariable && listing.type !== ListingType.DIRECT) {
      throw new BadRequestException('محصول متغیر فقط برای فروش مستقیم است');
    }

    if (dto.stockQuantity !== undefined && !syncingVariable) {
      if (dto.stockQuantity < 0) {
        throw new BadRequestException('موجودی نمی‌تواند منفی باشد');
      }
      listingData.stockQuantity = dto.stockQuantity;
    }

    const exchangeData: Prisma.ListingExchangeUpdateInput = {};
    if (dto.desiredTitle !== undefined) {
      exchangeData.desiredTitle = dto.desiredTitle.trim();
    }
    if (dto.desiredDescription !== undefined) {
      exchangeData.desiredDescription =
        sanitizeListingDescription(
          normalizeMultilineText(dto.desiredDescription).trim(),
          false,
        ) || null;
    }
    const patchExchange = Object.keys(exchangeData).length > 0;
    if (patchExchange && !listing.exchange) {
      throw new BadRequestException(
        'این آگهی فیلد کالای درخواستی معاوضه ندارد',
      );
    }

    if (dto.price !== undefined && listing.type !== ListingType.DIRECT) {
      throw new BadRequestException('قیمت فقط برای آگهی فروش مستقیم قابل ویرایش است');
    }
    if (
      (dto.basePrice !== undefined ||
        dto.minBidIncrement !== undefined ||
        dto.buyNowPrice !== undefined) &&
      listing.type !== ListingType.AUCTION
    ) {
      throw new BadRequestException('فیلدهای مزایده فقط برای آگهی مزایده قابل ویرایش است');
    }

    const variablePlan = syncingVariable
      ? normalizeVariableListing({
          axes: dto.variationAttributes,
          variations: dto.variations,
        })
      : null;

    if (variablePlan) {
      listingData.stockQuantity = variablePlan.stockQuantity;
      listingData.singleItemSale = variablePlan.singleItemSale;
    }

    const touchesDirectPricing =
      !syncingVariable &&
      (dto.price !== undefined ||
        dto.compareAtPrice !== undefined ||
        dto.salePrice !== undefined);
    if (touchesDirectPricing && listing.direct) {
      const price = dto.price ?? Number(listing.direct.price);
      const salePrice =
        dto.salePrice !== undefined
          ? dto.salePrice
          : listing.direct.salePrice != null
            ? Number(listing.direct.salePrice)
            : null;
      if (salePrice != null) {
        try {
          validateListingSalePricing({ price, salePrice });
        } catch (e) {
          throw new BadRequestException(
            e instanceof Error ? e.message : 'قیمت تخفیف نمی‌تواند بیشتر از قیمت اصلی باشد',
          );
        }
      }
    }

    return this.prisma.$transaction(async (tx) => {
      if (patchExchange) {
        await tx.listingExchange.update({
          where: { listingId },
          data: exchangeData,
        });
      }

      if (variablePlan) {
        await syncListingVariations(tx, listingId, {
          isVariable: true,
          axes: variablePlan.axes,
          variations: variablePlan.variations,
        });
        if (listing.direct) {
          await tx.listingDirect.update({
            where: { listingId },
            data: {
              price: variablePlan.direct.price,
              compareAtPrice: variablePlan.direct.compareAtPrice,
              salePrice: variablePlan.direct.salePrice,
              allowExchange: false,
            },
          });
        }
      } else if (clearingVariable && listing.isVariable) {
        await syncListingVariations(tx, listingId, {
          isVariable: false,
          axes: [],
          variations: [],
        });
      }

      if (touchesDirectPricing && listing.direct) {
        const directPatch: Prisma.ListingDirectUpdateInput = {};
        const effectivePrice = dto.price ?? Number(listing.direct.price);
        if (dto.price !== undefined) {
          directPatch.price = dto.price;
        }
        if (dto.salePrice !== undefined) {
          directPatch.salePrice = dto.salePrice;
          directPatch.compareAtPrice =
            dto.salePrice != null
              ? effectivePrice
              : dto.compareAtPrice !== undefined
                ? dto.compareAtPrice
                : null;
        } else if (dto.compareAtPrice !== undefined) {
          directPatch.compareAtPrice = dto.compareAtPrice;
        } else if (dto.price !== undefined) {
          const currentSale =
            listing.direct.salePrice != null
              ? Number(listing.direct.salePrice)
              : null;
          if (currentSale != null) {
            directPatch.compareAtPrice = effectivePrice;
          }
        }
        if (Object.keys(directPatch).length > 0) {
          await tx.listingDirect.update({
            where: { listingId },
            data: directPatch,
          });
        }
      }
      if (listing.auction) {
        const auctionData: Prisma.ListingAuctionUpdateInput = {};
        if (dto.basePrice !== undefined) auctionData.basePrice = dto.basePrice;
        if (dto.minBidIncrement !== undefined) {
          auctionData.minBidIncrement = dto.minBidIncrement;
        }
        if (dto.buyNowPrice !== undefined) {
          auctionData.buyNowPrice = dto.buyNowPrice;
        }
        if (Object.keys(auctionData).length > 0) {
          await tx.listingAuction.update({
            where: { listingId },
            data: auctionData,
          });
        }
      }
      return tx.listing.update({
        where: { id: listingId },
        data: listingData,
        include: ADMIN_LISTING_INCLUDE,
      });
    });
  }

  async approve(
    listingId: string,
    dto?: AdminListingCorrectionsDto,
  ): Promise<Listing> {
    if (dto && this.hasCorrections(dto)) {
      await this.applyCorrections(listingId, dto);
    }

    const updated = await this.approveCore(listingId);

    await this.notificationService.create({
      userId: updated.authorId,
      type: NotificationType.LISTING_APPROVED,
      title: 'آگهی شما تایید شد',
      message: `آگهی «${updated.title}» توسط ادمین تایید و منتشر شد.`,
      meta: { listingId: updated.id, listingType: updated.type },
    });

    return updated;
  }

  async approveMany(ids: string[]): Promise<BulkListingActionResponse> {
    const uniqueIds = [...new Set(ids)];
    const listings = await this.prisma.listing.findMany({
      where: { id: { in: uniqueIds } },
      select: {
        id: true,
        status: true,
        title: true,
        type: true,
        authorId: true,
      },
    });
    const byId = new Map(listings.map((l) => [l.id, l]));

    const results: BulkListingActionResult[] = [];
    const approvedForNotify: Array<{
      listingId: string;
      listingTitle: string;
      listingType: ListingType;
      authorId: string;
    }> = [];

    for (const id of uniqueIds) {
      const row = byId.get(id);
      if (!row) {
        results.push({ id, ok: false, error: 'آگهی یافت نشد' });
        continue;
      }
      if (row.status !== ListingStatus.PENDING) {
        results.push({ id, ok: false, error: 'فقط آگهی‌های در انتظار تایید قابل تایید گروهی هستند' });
        continue;
      }
      try {
        const updated = await this.approveCore(id);
        approvedForNotify.push({
          listingId: updated.id,
          listingTitle: updated.title,
          listingType: updated.type,
          authorId: updated.authorId,
        });
        results.push({ id, ok: true });
      } catch (err) {
        results.push({
          id,
          ok: false,
          error: (err as Error)?.message ?? 'خطای نامشخص',
        });
      }
    }

    await this.listingNotificationBatch.flushUserListingApprovedAlerts(
      approvedForNotify,
    );

    const processed = results.filter((r) => r.ok).length;
    return {
      processed,
      skipped: results.length - processed,
      results,
    };
  }

  private async approveCore(listingId: string): Promise<Listing> {
    const listing = await this.prisma.listing.findUnique({
      where: { id: listingId },
      select: { id: true, authorId: true, type: true, status: true },
    });
    if (!listing) throw new NotFoundException('آگهی یافت نشد');
    const approvedAt = new Date();
    const expiryFields = await this.listingExpiry.approvalExpiryFields(approvedAt);
    return this.prisma.$transaction(async (tx) => {
      await this.quotaService.consumeOnCreate(
        tx,
        listing.authorId,
        listing.type,
        listing.id,
      );
      return tx.listing.update({
        where: { id: listingId },
        data: {
          status: ListingStatus.APPROVED,
          approvedAt,
          ...expiryFields,
        },
      });
    });
  }

  reject(listingId: string, dto: RejectListingDto): Promise<Listing> {
    return this.rejectCore(listingId, dto.rejectionReason).then(async (updated) => {
      await this.notificationService.create({
        userId: updated.authorId,
        type: NotificationType.LISTING_REJECTED,
        title: 'آگهی شما رد شد',
        message: `آگهی «${updated.title}» رد شد. دلیل رد: ${dto.rejectionReason}. طبق قوانین طبقه، ${TRADE_REPUTATION_PENALTY_DELTA} واحد از امتیاز اعتماد شما کسر شد.`,
        meta: {
          listingId: updated.id,
          listingType: updated.type,
          reason: dto.rejectionReason,
        },
      });
      return updated;
    });
  }

  async rejectMany(
    ids: string[],
    rejectionReason: string,
  ): Promise<BulkListingActionResponse> {
    const uniqueIds = [...new Set(ids)];
    const listings = await this.prisma.listing.findMany({
      where: { id: { in: uniqueIds } },
      select: {
        id: true,
        status: true,
        title: true,
        type: true,
        authorId: true,
      },
    });
    const byId = new Map(listings.map((l) => [l.id, l]));

    const results: BulkListingActionResult[] = [];
    const rejectedForNotify: Array<{
      listingId: string;
      listingTitle: string;
      listingType: ListingType;
      authorId: string;
    }> = [];

    for (const id of uniqueIds) {
      const row = byId.get(id);
      if (!row) {
        results.push({ id, ok: false, error: 'آگهی یافت نشد' });
        continue;
      }
      if (row.status !== ListingStatus.PENDING) {
        results.push({ id, ok: false, error: 'فقط آگهی‌های در انتظار تایید قابل رد گروهی هستند' });
        continue;
      }
      try {
        const updated = await this.rejectCore(id, rejectionReason);
        rejectedForNotify.push({
          listingId: updated.id,
          listingTitle: updated.title,
          listingType: updated.type,
          authorId: updated.authorId,
        });
        results.push({ id, ok: true });
      } catch (err) {
        results.push({
          id,
          ok: false,
          error: (err as Error)?.message ?? 'خطای نامشخص',
        });
      }
    }

    await this.listingNotificationBatch.flushUserListingRejectedAlerts(
      rejectedForNotify,
      rejectionReason,
    );

    const processed = results.filter((r) => r.ok).length;
    return {
      processed,
      skipped: results.length - processed,
      results,
    };
  }

  private rejectCore(
    listingId: string,
    rejectionReason: string,
  ): Promise<Listing> {
    return this.prisma.$transaction(async (tx) => {
      const cycleStartedAt = new Date();
      const updated = await tx.listing.update({
        where: { id: listingId },
        data: {
          status: ListingStatus.REJECTED,
          rejectionReason,
          rejectedAt: cycleStartedAt,
          exchangeOffersSince: cycleStartedAt,
        },
      });
      await tx.exchangeOffer.updateMany({
        where: { listingId },
        data: { status: ExchangeOfferStatus.REJECTED },
      });
      await this.quotaService.releaseOnReject(tx, listingId);

      const author = await tx.user.findUnique({
        where: { id: updated.authorId },
        select: { rating: true },
      });
      if (author) {
        const current = Number(author.rating ?? 5);
        const next = Math.max(0, current - TRADE_REPUTATION_PENALTY_DELTA);
        await tx.user.update({
          where: { id: updated.authorId },
          data: { rating: next },
        });
      }

      return updated;
    });
  }

  async setStatus(listingId: string, status: ListingStatus): Promise<Listing> {
    const before = await this.prisma.listing.findUnique({
      where: { id: listingId },
      select: { id: true, status: true, title: true, authorId: true, type: true },
    });
    if (!before) throw new NotFoundException('آگهی یافت نشد');

    const data: Prisma.ListingUpdateInput = {
      status,
    };
    if (status === ListingStatus.APPROVED) {
      const approvedAt = new Date();
      const expiryFields = await this.listingExpiry.approvalExpiryFields(approvedAt);
      data.approvedAt = approvedAt;
      data.expiresAt = expiryFields.expiresAt as Date;
      data.expiryReminderSentAt = null;
    }
    const updated = await this.prisma.listing.update({
      where: { id: listingId },
      data,
    });

    if (
      status === ListingStatus.APPROVED &&
      before.status !== ListingStatus.APPROVED
    ) {
      await this.prisma.$transaction(async (tx) => {
        await this.quotaService.consumeOnCreate(
          tx,
          before.authorId,
          before.type,
          listingId,
        );
      });
      await this.notificationService.create({
        userId: before.authorId,
        type: NotificationType.LISTING_APPROVED,
        title: 'آگهی شما تایید شد',
        message: `آگهی «${before.title}» توسط ادمین تایید و منتشر شد.`,
        meta: { listingId: updated.id, listingType: before.type },
      });
    }

    return updated;
  }
}
