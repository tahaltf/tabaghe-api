import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  ExchangeOfferStatus,
  ExchangePayer,
  Listing,
  ListingImportSource,
  ListingStatus,
  ListingType,
  NotificationType,
  OrderStatus,
  Prisma,
  UserStatus,
} from '@prisma/client';
import { PrismaService } from '../../../infrastructure/prisma/prisma.service';
import { normalizeMultilineText } from '../../../common/multiline-text.util';
import { validateListingSalePricing } from '../../../common/listing/listing-price.util';
import { NotificationService } from '../../notification/notification.service';
import { QuotaService } from '../../quota/quota.service';
import { ListingExpiryService } from './listing-expiry.service';
import { CreateListingDto } from '../dto/create-listing.dto';
import { UpdateListingDto } from '../dto/update-listing.dto';
import { DeleteListingDto } from '../dto/delete-listing.dto';
import {
  ALL_LISTING_TYPE_ENABLED_SETTING_KEYS,
  isListingTypeEnabled,
  listingTypePersianLabel,
  parseListingTypesEnabledFromMap,
} from '../../../common/system-settings/listing-type-enabled';
import {
  isCategorySelectableForListing,
  isCategoryVisibleOnSite,
} from '../../../common/category-visibility.util';
import type { ListingAlertItem } from '../../../common/notification/listing-notification-batch.service';
import {
  hasBasicListingProfile,
  isIdentityVerified,
} from '../../../common/kyc/kyc-profile.util';
import {
  normalizeListingTitleKey,
  parseBulkPriceText,
} from '../utils/bulk-price-text.util';
import { CurrencyService } from '../../currency/currency.service';
import { BASE_CURRENCY_CODE } from '../../currency/providers/fx-provider';

/** حداقل امتیاز (rating) برای ثبت یا ارسال مجدد آگهی */
export const MIN_LISTING_AUTHOR_RATING = 1;

export type CreateListingOptions = {
  importSource?: ListingImportSource;
  externalSiteUrl?: string;
  externalProductId?: string;
  shortDescription?: string | null;
  attributes?: Prisma.InputJsonValue;
  adminNotificationMessage?: string;
  adminNotificationMeta?: Record<string, unknown>;
  skipAdminNotification?: boolean;
  onAdminAlert?: (item: ListingAlertItem) => void;
};

export type WordPressSyncOptions = {
  skipAdminNotification?: boolean;
  onAdminAlert?: (item: ListingAlertItem) => void;
};

export type WordPressSyncUpdateInput = {
  title: string;
  description: string;
  shortDescription?: string | null;
  attributes?: Prisma.InputJsonValue;
  gallery: string[];
  thumbnail: string | null;
  price: number;
  compareAtPrice?: number | null;
  salePrice?: number | null;
  categoryId: string;
  provinceId: string;
  cityId: string;
  stockQuantity: number;
  /** ارز قیمت (IRT/USD/AED/IQD)؛ برای فید خارجی الزامی است */
  priceCurrencyCode?: string | null;
};

function isSyncableImportSource(
  source: ListingImportSource | null | undefined,
): boolean {
  return (
    source === ListingImportSource.WORDPRESS ||
    source === ListingImportSource.JSON_FEED
  );
}

@Injectable()
export class ListingCommandService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly quotaService: QuotaService,
    private readonly notifications: NotificationService,
    private readonly listingExpiry: ListingExpiryService,
    private readonly currency: CurrencyService,
  ) {}

  async create(
    userId: string,
    dto: CreateListingDto,
    options?: CreateListingOptions,
  ): Promise<Listing> {
    await this.assertListingTypeEnabledForCreate(dto.type);
    const isDraft = dto.asDraft === true;
    this.validateListingPayload(dto, false, dto.type, isDraft);
    await this.assertCategoriesVisibleOnSite([
      dto.categoryId,
      dto.exchange?.desiredCategoryId,
    ]);
    await this.assertVerificationAllowedForListing({
      categoryId: dto.categoryId,
      type: dto.type,
      sellerRequiresVerification: dto.sellerRequiresVerification === true,
    });
    if (
      isDraft &&
      (!String(dto.categoryId ?? '').trim() ||
        !String(dto.provinceId ?? '').trim() ||
        !String(dto.cityId ?? '').trim())
    ) {
      throw new BadRequestException(
        'برای ذخیره پیش‌نویس در حساب، دسته، استان و شهر را انتخاب کنید.',
      );
    }

    const priceCurrencyCode = await this.currency.assertUserCanUseCurrency(
      userId,
      dto.type === ListingType.AUCTION
        ? BASE_CURRENCY_CODE
        : dto.priceCurrencyCode,
      dto.type,
    );
    const priceTomanCached = await this.currency.computePriceTomanCached({
      type: dto.type,
      priceCurrencyCode,
      direct: dto.direct,
      exchange: dto.exchange,
      auction: dto.auction,
    });
    const auctionEndDate = this.resolveAuctionEndDate(dto, isDraft);

    const listing = await this.prisma.$transaction(async (tx) => {
      const author = await tx.user.findUnique({
        where: { id: userId },
        select: {
          id: true,
          rating: true,
          status: true,
          isVerified: true,
          firstName: true,
          lastName: true,
          nationalCode: true,
        },
      });
      if (!author) {
        throw new NotFoundException('کاربر یافت نشد');
      }
      if (!hasBasicListingProfile(author)) {
        throw new ForbiddenException(
          'برای ثبت آگهی باید نام، نام خانوادگی و کد ملی را تکمیل کنید.',
        );
      }
      this.assertAuthorCanPublishListing(author.rating);
      if (!isDraft) {
        await this.assertUserCanCreateListingByKyc(tx, userId, {
          status: author.status,
          isVerified: author.isVerified,
        }, dto);
      }

      const listing = await tx.listing.create({
        data: {
          title: dto.title,
          type: dto.type,
          status: isDraft ? ListingStatus.DRAFT : ListingStatus.PENDING,
          condition: dto.condition,
          description: normalizeMultilineText(dto.description ?? ''),
          shippingPayer: dto.shippingPayer,
          exchangePayer: dto.exchangePayer ?? ExchangePayer.NONE,
          // فقط مقدار صریح true؛ هر چیز دیگر (undefined، "false"، 0، …) = false
          sellerRequiresVerification: dto.sellerRequiresVerification === true,
          testPeriodDays:
            dto.testPeriodDays != null && dto.testPeriodDays > 0
              ? dto.testPeriodDays
              : null,
          thumbnail: dto.thumbnail,
          gallery: dto.gallery ?? [],
          importSource: options?.importSource,
          externalSiteUrl: options?.externalSiteUrl,
          externalProductId: options?.externalProductId,
          shortDescription: options?.shortDescription ?? null,
          attributes: options?.attributes,
          stockQuantity:
            dto.stockQuantity != null && dto.stockQuantity >= 0
              ? dto.stockQuantity
              : 1,
          singleItemSale: dto.singleItemSale !== false,
          priceCurrencyCode,
          priceTomanCached,
          author: { connect: { id: userId } },
          category: { connect: { id: String(dto.categoryId) } },
          province: { connect: { id: String(dto.provinceId) } },
          city: { connect: { id: String(dto.cityId) } },
          direct:
            dto.type === ListingType.DIRECT
              ? {
                  create: this.buildDirectCreateData(dto.direct),
                }
              : undefined,
          exchange: this.shouldCreateExchange(dto)
            ? {
                create: {
                  desiredCategoryId: dto.exchange?.desiredCategoryId ?? '',
                  desiredTitle: dto.exchange?.desiredTitle ?? '',
                  desiredDescription: dto.exchange?.desiredDescription != null
                    ? normalizeMultilineText(dto.exchange.desiredDescription)
                    : dto.exchange?.desiredDescription,
                  ownValue: dto.exchange?.ownValue ?? 0,
                  extraPaymentAmount: dto.exchange?.extraPaymentAmount ?? 0,
                },
              }
            : undefined,
          auction:
            dto.type === ListingType.AUCTION && auctionEndDate
              ? {
                  create: {
                    basePrice: dto.auction?.basePrice ?? 0,
                    minBidIncrement: dto.auction?.minBidIncrement ?? 5000,
                    endDatetime: auctionEndDate,
                    buyNowEnabled: dto.auction?.buyNowEnabled ?? false,
                    buyNowPrice: dto.auction?.buyNowPrice,
                  },
                }
              : undefined,
        },
      });

      return listing;
    });

    if (!isDraft) {
      void this.dispatchAdminNewListingAlert(
        userId,
        listing,
        options,
        false,
      );
    }

    return listing;
  }

  private async assertUserCanCreateListingByKyc(
    tx: Prisma.TransactionClient,
    userId: string,
    user: { status: UserStatus; isVerified: boolean },
    dto: CreateListingDto,
  ): Promise<void> {
    const rows = await tx.systemSetting.findMany({
      where: {
        key: {
          in: [
            'KYC_ALLOW_LISTING_WITH_MOBILE',
            'KYC_UNVERIFIED_LISTING_LIMIT',
            'KYC_UNVERIFIED_MAX_AMOUNT',
          ],
        },
      },
      select: { key: true, value: true },
    });
    const map: Record<string, string> = {};
    for (const row of rows) map[row.key] = row.value;

    const identityOk = isIdentityVerified(user);
    if (identityOk) return;

    const allowMobile =
      String(map.KYC_ALLOW_LISTING_WITH_MOBILE ?? 'true').toLowerCase() !== 'false';
    if (!allowMobile) {
      throw new ForbiddenException(
        'برای ثبت آگهی باید احراز هویت کاربری را تکمیل کنید.',
      );
    }

    const rawLimit = Number(map.KYC_UNVERIFIED_LISTING_LIMIT ?? '1');
    const limit = Number.isFinite(rawLimit)
      ? Math.max(0, Math.floor(rawLimit))
      : 1;
    if (limit <= 0) {
      throw new ForbiddenException(
        'ثبت آگهی برای کاربران بدون احراز کامل غیرفعال است.',
      );
    }

    const activeCount = await tx.listing.count({
      where: {
        authorId: userId,
        status: {
          in: [ListingStatus.PENDING, ListingStatus.APPROVED],
        },
      },
    });
    if (activeCount >= limit) {
      throw new ForbiddenException(
        `برای ثبت بیش از ${limit} آگهی، باید احراز هویت کاربری را تکمیل کنید.`,
      );
    }

    const rawMax = Number(map.KYC_UNVERIFIED_MAX_AMOUNT ?? '0');
    const maxAmount = Number.isFinite(rawMax) ? Math.max(0, Math.floor(rawMax)) : 0;
    if (maxAmount > 0 && dto.type === ListingType.DIRECT) {
      const priceForeign = Number(dto.direct?.price ?? 0);
      const currencyCode = this.currency.normalizeCode(dto.priceCurrencyCode);
      let priceToman = priceForeign;
      try {
        priceToman = await this.currency.toToman(priceForeign, currencyCode);
      } catch {
        priceToman = priceForeign;
      }
      if (priceToman > maxAmount) {
        throw new ForbiddenException(
          `سقف مبلغ آگهی برای کاربر بدون احراز کامل ${maxAmount.toLocaleString('fa-IR')} تومان است.`,
        );
      }
    }
  }

  private dispatchAdminNewListingAlert(
    userId: string,
    listing: Listing,
    options: CreateListingOptions | undefined,
    resubmittedAfterReject: boolean,
    customMessage?: string,
    customTitle?: string,
  ): void {
    const alertItem: ListingAlertItem = {
      listingId: listing.id,
      listingTitle: listing.title,
      listingType: listing.type,
      userId,
      importSource: options?.importSource ?? listing.importSource ?? undefined,
      resubmittedAfterReject,
      adminNotificationMessage:
        customMessage ??
        options?.adminNotificationMessage ??
        (resubmittedAfterReject
          ? `آگهی «${listing.title}» (${listingTypePersianLabel(listing.type)}) پس از رد/اصلاح توسط فروشنده دوباره برای بررسی ارسال شد.`
          : `آگهی «${listing.title}» (${listingTypePersianLabel(listing.type)}) ثبت شد و در انتظار بررسی است.`),
      adminNotificationTitle:
        customTitle ??
        (resubmittedAfterReject
          ? 'آگهی اصلاح‌شده در انتظار تایید'
          : 'آگهی جدید در انتظار تایید'),
    };

    if (options?.skipAdminNotification) {
      options.onAdminAlert?.(alertItem);
      return;
    }

    void this.notifications
      .notifyAdminPersonnel({
        type: NotificationType.ADMIN_ALERT_NEW_LISTING,
        title: alertItem.adminNotificationTitle!,
        message: alertItem.adminNotificationMessage!,
        meta: {
          listingId: listing.id,
          userId,
          listingTitle: listing.title,
          listingType: listing.type,
          ...(options?.adminNotificationMeta ?? {}),
          ...(resubmittedAfterReject ? { resubmittedAfterReject: true } : {}),
        },
      })
      .catch(() => undefined);
  }

  async syncWordPressListing(
    userId: string,
    listingId: string,
    input: WordPressSyncUpdateInput,
    options?: WordPressSyncOptions,
  ): Promise<Listing> {
    const listing = await this.ensureListingCanBeModified(listingId, userId, {
      allowWordPressRestock: true,
    });

    const author = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { rating: true },
    });
    if (!author) {
      throw new NotFoundException('کاربر یافت نشد');
    }
    this.assertAuthorCanPublishListing(author.rating);

    if (Number(input.price) <= 0) {
      throw new BadRequestException(
        'برای ثبت آگهی، این موارد را تکمیل کنید: قیمت فروش (باید بیشتر از صفر باشد)',
      );
    }

    await this.assertCategoriesVisibleOnSite([input.categoryId]);

    const priceCurrencyCode = await this.currency.assertUserCanUseCurrency(
      userId,
      input.priceCurrencyCode ?? listing.priceCurrencyCode,
      ListingType.DIRECT,
    );
    const priceTomanCached = await this.currency.computePriceTomanCached({
      type: ListingType.DIRECT,
      priceCurrencyCode,
      direct: {
        price: input.price,
        salePrice: input.salePrice,
      },
    });

    const wasRejected = listing.status === ListingStatus.REJECTED;
    const wasPending = listing.status === ListingStatus.PENDING;
    const shouldRestoreApproved =
      (listing.status === ListingStatus.ARCHIVED ||
        listing.status === ListingStatus.SOLD) &&
      isSyncableImportSource(listing.importSource) &&
      input.stockQuantity > 0;

    const importSource =
      listing.importSource === ListingImportSource.JSON_FEED
        ? ListingImportSource.JSON_FEED
        : ListingImportSource.WORDPRESS;
    const sourceLabel =
      importSource === ListingImportSource.JSON_FEED ? 'فید خارجی' : 'وردپرس';

    const data: Prisma.ListingUpdateInput = {
      title: input.title.trim(),
      description: normalizeMultilineText(input.description),
      shortDescription: input.shortDescription ?? null,
      attributes: input.attributes,
      gallery: input.gallery,
      thumbnail: input.thumbnail,
      category: { connect: { id: input.categoryId } },
      province: { connect: { id: input.provinceId } },
      city: { connect: { id: input.cityId } },
      stockQuantity: input.stockQuantity,
      priceCurrencyCode,
      priceTomanCached,
      direct: {
        upsert: {
          create: {
            price: input.price,
            compareAtPrice: input.compareAtPrice ?? null,
            salePrice: input.salePrice ?? null,
            allowExchange: false,
            shippingMethods: [],
          },
          update: {
            price: input.price,
            compareAtPrice: input.compareAtPrice ?? null,
            salePrice: input.salePrice ?? null,
          },
        },
      },
    };

    let notifyPendingReview = false;

    if (wasRejected || wasPending) {
      data.status = ListingStatus.PENDING;
      data.rejectionReason = null;
      data.rejectedAt = null;
      data.expiresAt = null;
      data.expiryReminderSentAt = null;
      if (wasRejected) {
        data.exchangeOffersSince = new Date();
      }
      notifyPendingReview = true;
    } else if (listing.status === ListingStatus.APPROVED || shouldRestoreApproved) {
      const approvedAt = new Date();
      const expiryFields = await this.listingExpiry.approvalExpiryFields(approvedAt);
      data.status = ListingStatus.APPROVED;
      data.approvedAt = approvedAt;
      data.expiresAt = expiryFields.expiresAt as Date;
      data.expiryReminderSentAt = null;
      data.rejectionReason = null;
      data.rejectedAt = null;
    }

    const updated = await this.prisma.listing.update({
      where: { id: listingId },
      data,
      include: { direct: true },
    });

    if (notifyPendingReview) {
      this.dispatchAdminNewListingAlert(
        userId,
        updated,
        {
          skipAdminNotification: options?.skipAdminNotification,
          onAdminAlert: options?.onAdminAlert,
          importSource,
        },
        wasRejected,
        wasRejected
          ? `آگهی «${updated.title}» (${listingTypePersianLabel(updated.type)}) پس از رد/اصلاح توسط فروشنده از ${sourceLabel} دوباره برای بررسی ارسال شد.`
          : `آگهی «${updated.title}» (${listingTypePersianLabel(updated.type)}) از ${sourceLabel} ویرایش شد و در انتظار بررسی است.`,
        wasRejected
          ? 'آگهی اصلاح‌شده در انتظار تایید'
          : 'آگهی ویرایش‌شده در انتظار تایید',
      );
    }

    return updated;
  }

  async archiveWordPressUnavailableListing(
    userId: string,
    listingId: string,
    input: WordPressSyncUpdateInput,
  ): Promise<{ listing: Listing; archived: boolean }> {
    const listing = await this.ensureListingCanBeModified(listingId, userId);

    const author = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { rating: true },
    });
    if (!author) {
      throw new NotFoundException('کاربر یافت نشد');
    }
    this.assertAuthorCanPublishListing(author.rating);

    const shouldArchive = listing.status === ListingStatus.APPROVED;

    const updated = await this.prisma.listing.update({
      where: { id: listingId },
      data: {
        title: input.title.trim(),
        description: normalizeMultilineText(input.description),
        shortDescription: input.shortDescription ?? null,
        attributes: input.attributes,
        gallery: input.gallery,
        thumbnail: input.thumbnail,
        ...(shouldArchive ? { status: ListingStatus.ARCHIVED } : {}),
        stockQuantity: input.stockQuantity,
        direct: {
          upsert: {
            create: {
              price: input.price,
              compareAtPrice: input.compareAtPrice ?? null,
              salePrice: input.salePrice ?? null,
              allowExchange: false,
              shippingMethods: [],
            },
            update: {
              price: input.price,
              compareAtPrice: input.compareAtPrice ?? null,
              salePrice: input.salePrice ?? null,
            },
          },
        },
      },
      include: { direct: true },
    });

    return { listing: updated, archived: shouldArchive };
  }

  async archiveWordPressRemovedListing(
    userId: string,
    listingId: string,
  ): Promise<{ listing: Listing; archived: boolean }> {
    const listing = await this.ensureListingCanBeModified(listingId, userId);
    if (!isSyncableImportSource(listing.importSource)) {
      throw new BadRequestException('این آگهی از منبع خارجی وارد نشده است');
    }

    const archivable = new Set<ListingStatus>([
      ListingStatus.APPROVED,
      ListingStatus.PENDING,
      ListingStatus.REJECTED,
    ]);
    const shouldArchive = archivable.has(listing.status);

    const updated = await this.prisma.listing.update({
      where: { id: listingId },
      data: shouldArchive ? { status: ListingStatus.ARCHIVED } : {},
      include: { direct: true },
    });

    return { listing: updated, archived: shouldArchive };
  }

  async update(
    userId: string,
    listingId: string,
    dto: UpdateListingDto,
  ): Promise<Listing> {
    await this.ensureListingCanBeModified(listingId, userId);

    const author = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { rating: true },
    });
    if (!author) {
      throw new NotFoundException('کاربر یافت نشد');
    }
    this.assertAuthorCanPublishListing(author.rating);

    const listing = await this.prisma.listing.findUniqueOrThrow({
      where: { id: listingId },
      include: { direct: true, exchange: true, auction: true },
    });

    const currentType = dto.type ?? listing.type;
    if (dto.type !== undefined && dto.type !== listing.type) {
      await this.assertListingTypeEnabledForCreate(dto.type);
    }
    const keepDraft =
      dto.asDraft === true && listing.status === ListingStatus.DRAFT;
    this.validateListingPayload(dto, true, currentType, keepDraft);
    await this.assertCategoriesVisibleOnSite([
      dto.categoryId,
      dto.exchange?.desiredCategoryId,
    ]);
    const wantsVerification =
      dto.sellerRequiresVerification === undefined
        ? listing.sellerRequiresVerification
        : dto.sellerRequiresVerification === true;
    await this.assertVerificationAllowedForListing({
      categoryId: dto.categoryId ?? listing.categoryId,
      type: currentType,
      sellerRequiresVerification: wantsVerification,
    });
    const auctionEndDate =
      currentType === ListingType.AUCTION && dto.auction?.endDatetime
        ? new Date(dto.auction.endDatetime)
        : (listing.auction?.endDatetime ?? undefined);

    const priceCurrencyCode = await this.currency.assertUserCanUseCurrency(
      userId,
      currentType === ListingType.AUCTION
        ? BASE_CURRENCY_CODE
        : (dto.priceCurrencyCode ?? listing.priceCurrencyCode),
      currentType,
    );
    const priceTomanCached = await this.currency.computePriceTomanCached({
      type: currentType,
      priceCurrencyCode,
      direct: dto.direct ?? {
        price: listing.direct ? Number(listing.direct.price) : null,
        salePrice: listing.direct?.salePrice
          ? Number(listing.direct.salePrice)
          : null,
      },
      exchange: dto.exchange ?? {
        ownValue: listing.exchange ? Number(listing.exchange.ownValue) : null,
        directPrice: listing.exchange?.directPrice
          ? Number(listing.exchange.directPrice)
          : null,
      },
      auction: dto.auction ?? {
        basePrice: listing.auction ? Number(listing.auction.basePrice) : null,
      },
    });

    const wasRejected = listing.status === ListingStatus.REJECTED;
    const wasDraft = listing.status === ListingStatus.DRAFT;
    const updated = await this.prisma.listing.update({
      where: { id: listingId },
      data: {
        title: dto.title,
        description: dto.description !== undefined
          ? normalizeMultilineText(dto.description)
          : dto.description,
        condition: dto.condition,
        shippingPayer: dto.shippingPayer,
        exchangePayer: dto.exchangePayer ?? listing.exchangePayer,
        sellerRequiresVerification:
          dto.sellerRequiresVerification === undefined
            ? listing.sellerRequiresVerification
            : dto.sellerRequiresVerification === true,
        testPeriodDays:
          dto.testPeriodDays !== undefined
            ? dto.testPeriodDays != null && dto.testPeriodDays > 0
              ? dto.testPeriodDays
              : null
            : listing.testPeriodDays,
        thumbnail: dto.thumbnail,
        gallery: dto.gallery,
        type: currentType,
        status: keepDraft ? ListingStatus.DRAFT : ListingStatus.PENDING,
        rejectionReason: null,
        rejectedAt: null,
        priceCurrencyCode,
        priceTomanCached,
        ...(wasRejected ? { exchangeOffersSince: new Date() } : {}),
        expiresAt: null,
        expiryReminderSentAt: null,
        ...(dto.stockQuantity !== undefined &&
        dto.stockQuantity >= 0 &&
        listing.importSource !== ListingImportSource.WORDPRESS &&
        listing.importSource !== ListingImportSource.JSON_FEED
          ? { stockQuantity: dto.stockQuantity }
          : {}),
        ...(dto.singleItemSale !== undefined
          ? { singleItemSale: dto.singleItemSale !== false }
          : {}),
        ...(dto.categoryId && {
          category: { connect: { id: dto.categoryId } },
        }),
        ...(dto.provinceId && {
          province: { connect: { id: dto.provinceId } },
        }),
        ...(dto.cityId && { city: { connect: { id: dto.cityId } } }),
        direct: this.buildDirectUpsert(currentType, dto, listing),
        exchange: this.buildExchangeUpsert(currentType, dto, listing),
        auction: this.buildAuctionUpsert(
          currentType,
          dto,
          listing,
          auctionEndDate,
        ),
      },
    });

    if (updated.status === ListingStatus.PENDING) {
      void this.notifications
        .notifyAdminPersonnel({
          type: NotificationType.ADMIN_ALERT_NEW_LISTING,
          title: wasRejected
            ? 'آگهی اصلاح‌شده در انتظار تایید'
            : wasDraft
              ? 'آگهی جدید در انتظار تایید'
              : 'آگهی ویرایش‌شده در انتظار تایید',
          message: wasRejected
            ? `آگهی «${updated.title}» (${listingTypePersianLabel(updated.type)}) پس از رد/اصلاح توسط فروشنده دوباره برای بررسی ارسال شد.`
            : wasDraft
              ? `آگهی «${updated.title}» (${listingTypePersianLabel(updated.type)}) از پیش‌نویس برای بررسی ارسال شد.`
              : `آگهی «${updated.title}» (${listingTypePersianLabel(updated.type)}) ویرایش شد و در انتظار بررسی است.`,
          meta: {
            listingId: updated.id,
            userId,
            listingTitle: updated.title,
            listingType: updated.type,
            resubmittedAfterReject: wasRejected,
          },
        })
        .catch(() => undefined);
    }

    return updated;
  }

  async renewDisplay(
    userId: string,
    listingId: string,
  ): Promise<Listing> {
    const listing = await this.prisma.listing.findUnique({
      where: { id: listingId },
    });
    if (!listing) throw new NotFoundException('آگهی یافت نشد');
    if (listing.authorId !== userId) {
      throw new ForbiddenException('شما مالک این آگهی نیستید');
    }
    if (
      listing.status !== ListingStatus.APPROVED &&
      listing.status !== ListingStatus.ARCHIVED
    ) {
      throw new BadRequestException('فقط آگهی منتشر یا آرشیوشده قابل تمدید است.');
    }
    const approvedAt = new Date();
    const expiryFields = await this.listingExpiry.approvalExpiryFields(approvedAt);
    return this.prisma.listing.update({
      where: { id: listingId },
      data: {
        status: ListingStatus.APPROVED,
        approvedAt,
        ...expiryFields,
        expiryReminderSentAt: null,
      },
    });
  }

  /** خروجی متنی همه محصولات فروش مستقیم برای کپی/ویرایش قیمت */
  async exportBulkPriceText(userId: string) {
    const listings = await this.prisma.listing.findMany({
      where: {
        authorId: userId,
        type: ListingType.DIRECT,
        status: {
          in: [
            ListingStatus.APPROVED,
            ListingStatus.PENDING,
            ListingStatus.DRAFT,
          ],
        },
      },
      select: {
        title: true,
        stockQuantity: true,
        direct: { select: { price: true, salePrice: true } },
      },
      orderBy: { title: 'asc' },
    });

    const lines: string[] = [];
    for (const listing of listings) {
      if (!listing.direct) continue;
      const title = listing.title.trim();
      if (!title) continue;
      const stock = listing.stockQuantity ?? 1;
      if (stock <= 0) {
        lines.push(`${title} = 0`);
        continue;
      }
      const price = Number(
        listing.direct.salePrice != null && Number(listing.direct.salePrice) > 0
          ? listing.direct.salePrice
          : listing.direct.price,
      );
      if (!Number.isFinite(price) || price < 0) continue;
      lines.push(`${title} = ${Math.floor(price)}`);
    }

    return {
      text: lines.join('\n'),
      count: lines.length,
    };
  }

  /** پیش‌نمایش آپدیت فوری قیمت — بدون اعمال */
  async previewBulkPricesFromText(userId: string, text: string) {
    const plan = await this.buildBulkPricePlan(userId, text);
    return this.summarizeBulkPricePlan(plan, 'preview');
  }

  /**
   * آپدیت فوری قیمت از متن چندخطی — فقط قیمت/موجودی؛ بدون برگشت به PENDING.
   * قیمت ۰ = ناموجود (stockQuantity = 0).
   */
  async bulkUpdatePricesFromText(userId: string, text: string) {
    const plan = await this.buildBulkPricePlan(userId, text);

    for (const row of plan.willUpdate) {
      if (row.action === 'unavailable') {
        await this.prisma.listing.update({
          where: { id: row.listingId! },
          data: { stockQuantity: 0 },
        });
        continue;
      }

      await this.prisma.listingDirect.update({
        where: { listingId: row.listingId! },
        data: {
          price: row.newPrice!,
          salePrice: null,
          compareAtPrice: null,
        },
      });
      if (row.restockTo != null) {
        await this.prisma.listing.update({
          where: { id: row.listingId! },
          data: { stockQuantity: row.restockTo },
        });
      }
    }

    return this.summarizeBulkPricePlan(plan, 'apply');
  }

  private async buildBulkPricePlan(userId: string, text: string) {
    const MAX_LINES = 200;
    const { items, failures } = parseBulkPriceText(text);

    if (items.length === 0 && failures.length === 0) {
      throw new BadRequestException('متنی برای پردازش وجود ندارد');
    }
    if (items.length > MAX_LINES) {
      throw new BadRequestException(
        `حداکثر ${MAX_LINES} خط قیمت در هر ارسال مجاز است`,
      );
    }

    type PlanRow = {
      lineNumber: number;
      query: string;
      status: 'will_update' | 'skipped';
      code?:
        | 'not_found'
        | 'invalid'
        | 'ambiguous'
        | 'locked'
        | 'unchanged'
        | 'no_direct';
      reason?: string;
      listingId?: string;
      title?: string;
      oldPrice?: number;
      newPrice?: number;
      action?: 'price' | 'unavailable';
      restockTo?: number;
      stockQuantity?: number;
    };

    const skipped: PlanRow[] = failures.map((f) => ({
      lineNumber: f.lineNumber,
      query: f.rawLine,
      status: 'skipped' as const,
      code: 'invalid' as const,
      reason: f.reason,
    }));
    const willUpdate: PlanRow[] = [];

    if (items.length === 0) {
      return { willUpdate, skipped };
    }

    const listings = await this.prisma.listing.findMany({
      where: {
        authorId: userId,
        type: ListingType.DIRECT,
        status: {
          in: [
            ListingStatus.APPROVED,
            ListingStatus.PENDING,
            ListingStatus.DRAFT,
          ],
        },
      },
      select: {
        id: true,
        title: true,
        status: true,
        stockQuantity: true,
        direct: { select: { price: true, salePrice: true } },
      },
    });

    const byId = new Map(listings.map((l) => [l.id, l]));
    const byTitle = new Map<string, typeof listings>();
    for (const listing of listings) {
      const key = normalizeListingTitleKey(listing.title);
      const bucket = byTitle.get(key) ?? [];
      bucket.push(listing);
      byTitle.set(key, bucket);
    }

    const deduped = new Map<string, (typeof items)[number]>();
    for (const item of items) {
      deduped.set(normalizeListingTitleKey(item.query), item);
    }

    for (const item of deduped.values()) {
      const byExactId = byId.get(item.query);
      const matches = byExactId
        ? [byExactId]
        : (byTitle.get(normalizeListingTitleKey(item.query)) ?? []);

      if (matches.length === 0) {
        skipped.push({
          lineNumber: item.lineNumber,
          query: item.query,
          status: 'skipped',
          code: 'not_found',
          reason:
            'در آگهی‌های شما پیدا نشد؛ این مورد آپدیت نمی‌شود. اگر می‌خواهید، از «آگهی‌های من» دستی ویرایش کنید.',
          newPrice: item.price,
        });
        continue;
      }
      if (matches.length > 1) {
        skipped.push({
          lineNumber: item.lineNumber,
          query: item.query,
          status: 'skipped',
          code: 'ambiguous',
          reason: `چند آگهی با عنوان یکسان یافت شد (${matches.length} مورد)؛ عنوان را دقیق‌تر کنید یا از شناسه استفاده کنید`,
          newPrice: item.price,
        });
        continue;
      }

      const listing = matches[0];
      if (!listing.direct) {
        skipped.push({
          lineNumber: item.lineNumber,
          query: item.query,
          status: 'skipped',
          code: 'no_direct',
          reason: 'این آگهی قیمت فروش مستقیم ندارد',
          listingId: listing.id,
          title: listing.title,
          newPrice: item.price,
        });
        continue;
      }

      try {
        await this.ensureListingCanBeModified(listing.id, userId);
      } catch (e) {
        skipped.push({
          lineNumber: item.lineNumber,
          query: item.query,
          status: 'skipped',
          code: 'locked',
          reason:
            e instanceof Error ? e.message : 'امکان تغییر این آگهی وجود ندارد',
          listingId: listing.id,
          title: listing.title,
          oldPrice: Number(listing.direct.price),
          newPrice: item.price,
          stockQuantity: listing.stockQuantity ?? 1,
        });
        continue;
      }

      const oldPrice = Number(
        listing.direct.salePrice != null && Number(listing.direct.salePrice) > 0
          ? listing.direct.salePrice
          : listing.direct.price,
      );
      const stock = listing.stockQuantity ?? 1;

      if (item.price === 0) {
        if (stock <= 0) {
          skipped.push({
            lineNumber: item.lineNumber,
            query: item.query,
            status: 'skipped',
            code: 'unchanged',
            reason: 'قبلاً ناموجود است',
            listingId: listing.id,
            title: listing.title,
            oldPrice,
            newPrice: 0,
            stockQuantity: stock,
          });
          continue;
        }
        willUpdate.push({
          lineNumber: item.lineNumber,
          query: item.query,
          status: 'will_update',
          listingId: listing.id,
          title: listing.title,
          oldPrice,
          newPrice: 0,
          action: 'unavailable',
          stockQuantity: stock,
        });
        continue;
      }

      const needsRestock = stock <= 0;
      if (oldPrice === item.price && !needsRestock) {
        skipped.push({
          lineNumber: item.lineNumber,
          query: item.query,
          status: 'skipped',
          code: 'unchanged',
          reason: 'قیمت تغییری نکرده است',
          listingId: listing.id,
          title: listing.title,
          oldPrice,
          newPrice: item.price,
          stockQuantity: stock,
        });
        continue;
      }

      willUpdate.push({
        lineNumber: item.lineNumber,
        query: item.query,
        status: 'will_update',
        listingId: listing.id,
        title: listing.title,
        oldPrice,
        newPrice: item.price,
        action: 'price',
        restockTo: needsRestock ? 1 : undefined,
        stockQuantity: stock,
      });
    }

    return { willUpdate, skipped };
  }

  private summarizeBulkPricePlan(
    plan: {
      willUpdate: Array<{
        lineNumber: number;
        query: string;
        status: 'will_update' | 'skipped';
        code?: string;
        reason?: string;
        listingId?: string;
        title?: string;
        oldPrice?: number;
        newPrice?: number;
        action?: 'price' | 'unavailable';
        restockTo?: number;
        stockQuantity?: number;
      }>;
      skipped: Array<{
        lineNumber: number;
        query: string;
        status: 'will_update' | 'skipped';
        code?: string;
        reason?: string;
        listingId?: string;
        title?: string;
        oldPrice?: number;
        newPrice?: number;
        action?: 'price' | 'unavailable';
        stockQuantity?: number;
      }>;
    },
    mode: 'preview' | 'apply',
  ) {
    const appliedOrPlanned = plan.willUpdate.map((row) => ({
      ...row,
      status: mode === 'apply' ? ('updated' as const) : ('will_update' as const),
    }));
    return {
      summary: {
        total: appliedOrPlanned.length + plan.skipped.length,
        updated: mode === 'apply' ? appliedOrPlanned.length : 0,
        willUpdate: appliedOrPlanned.length,
        skipped: plan.skipped.length,
        notFound: plan.skipped.filter((s) => s.code === 'not_found').length,
        invalid: plan.skipped.filter((s) => s.code === 'invalid').length,
      },
      willUpdate: appliedOrPlanned,
      updated: mode === 'apply' ? appliedOrPlanned : [],
      skipped: plan.skipped,
    };
  }

  /**
   * پس از رد کارشناسی، شکایت، یا لغو معامله — آگهی از انتشار خارج می‌شود
   * تا فروشنده بتواند اصلاح و مجدداً برای تایید ارسال کند.
   */
  async rejectAfterTradeFailure(
    tx: Prisma.TransactionClient,
    params: {
      listingId: string;
      sellerId: string;
      listingTitle: string;
      rejectionReason: string;
      source:
        | 'hub-inspection'
        | 'dispute'
        | 'dispute-refund'
        | 'shipping-timeout';
      orderId?: string;
    },
  ): Promise<void> {
    const reason = params.rejectionReason.trim();
    if (reason.length < 3) return;

    const listing = await tx.listing.findUnique({
      where: { id: params.listingId },
      select: { id: true, status: true, authorId: true },
    });
    if (!listing || listing.authorId !== params.sellerId) return;
    if (listing.status === ListingStatus.DELETED_BY_USER) return;

    const cycleStartedAt = new Date();
    await tx.listing.update({
      where: { id: params.listingId },
      data: {
        status: ListingStatus.REJECTED,
        rejectionReason: reason,
        rejectedAt: cycleStartedAt,
        exchangeOffersSince: cycleStartedAt,
      },
    });
    await tx.exchangeOffer.updateMany({
      where: { listingId: params.listingId },
      data: { status: ExchangeOfferStatus.REJECTED },
    });
    await this.quotaService.releaseOnReject(tx, params.listingId);

    const title = params.listingTitle?.trim() || 'آگهی';
    const messages: Record<typeof params.source, string> = {
      'hub-inspection': `آگهی «${title}» پس از رد کارشناسی در طبقه از انتشار خارج شد. برای فروش مجدد، آگهی را در «آگهی‌های من» اصلاح و دوباره ارسال کنید.`,
      dispute: `آگهی «${title}» به‌دلیل ثبت شکایت خریدار موقتاً از انتشار خارج شد. پس از رسیدگی می‌توانید آن را اصلاح و مجدداً ارسال کنید.`,
      'dispute-refund': `آگهی «${title}» پس از تأیید مرجوعی و بازگشت وجه رد شد. برای فروش مجدد، آگهی را اصلاح و دوباره برای تایید ارسال کنید.`,
      'shipping-timeout': `آگهی «${title}» پس از لغو معامله (عدم ارسال در مهلت) رد شد. برای فروش مجدد، آگهی را ویرایش و دوباره ارسال کنید.`,
    };

    await tx.notification.create({
      data: {
        userId: params.sellerId,
        type: NotificationType.LISTING_REJECTED,
        title: 'آگهی نیاز به اصلاح دارد',
        message: messages[params.source],
        meta: {
          listingId: params.listingId,
          reason: params.source,
          ...(params.orderId ? { orderId: params.orderId } : {}),
        } as Prisma.InputJsonValue,
      },
    });
  }

  async softDelete(
    userId: string,
    listingId: string,
    dto: DeleteListingDto,
  ): Promise<Listing> {
    await this.ensureListingCanBeModified(listingId, userId);

    return this.prisma.$transaction(async (tx) => {
      await tx.exchangeOffer.deleteMany({ where: { listingId } });
      return tx.listing.update({
        where: { id: listingId },
        data: {
          status: ListingStatus.DELETED_BY_USER,
          deleteReason: dto.deleteReason,
          deletedAt: new Date(),
        },
      });
    });
  }

  private resolveAuctionEndDate(
    dto: CreateListingDto,
    isDraft = false,
  ): Date | undefined {
    if (dto.type !== ListingType.AUCTION) return undefined;
    if (!dto.auction?.endDatetime) {
      if (isDraft) return undefined;
      throw new BadRequestException('زمان پایان مزایده الزامی است');
    }
    if (
      dto.auction?.minBidIncrement !== undefined &&
      dto.auction.minBidIncrement < 5000
    ) {
      throw new BadRequestException(
        'حداقل گام افزایش مزایده باید حداقل ۵۰۰۰ باشد',
      );
    }
    const end = new Date(dto.auction.endDatetime);
    if (end.getTime() <= Date.now()) {
      throw new BadRequestException(
        'زمان پایان مزایده نمی‌تواند در گذشته باشد',
      );
    }
    return end;
  }

  private async loadListingTypesEnabled() {
    const rows = await this.prisma.systemSetting.findMany({
      where: { key: { in: [...ALL_LISTING_TYPE_ENABLED_SETTING_KEYS] } },
      select: { key: true, value: true },
    });
    const map: Record<string, string> = {};
    for (const row of rows) map[row.key] = row.value;
    return parseListingTypesEnabledFromMap(map);
  }

  private async assertCategoriesVisibleOnSite(
    categoryIds: Array<string | undefined | null>,
  ): Promise<void> {
    const ids = [
      ...new Set(
        categoryIds.filter((id): id is string => typeof id === 'string' && !!id.trim()),
      ),
    ];
    if (!ids.length) return;

    const rows = await this.prisma.category.findMany({
      select: { id: true, parentId: true, isActive: true },
    });
    const byId = new Map(rows.map((r) => [r.id, r]));
    for (const id of ids) {
      if (!isCategoryVisibleOnSite(id, byId)) {
        throw new BadRequestException(
          'دسته‌بندی انتخاب‌شده در حال حاضر غیرفعال است.',
        );
      }
      if (!isCategorySelectableForListing(id, byId)) {
        throw new BadRequestException(
          'دسته‌بندی انتخاب‌شده باید زیردستهٔ نهایی باشد؛ دسته‌های والد قابل انتخاب نیستند.',
        );
      }
    }
  }

  /**
   * Blocks sellerRequiresVerification / exchange when the category disables hub verification.
   */
  private async assertVerificationAllowedForListing(params: {
    categoryId: string | undefined | null;
    type: ListingType;
    sellerRequiresVerification: boolean;
  }): Promise<void> {
    const needsCheck =
      params.sellerRequiresVerification || params.type === ListingType.EXCHANGE;
    if (!needsCheck || !params.categoryId?.trim()) return;

    const category = await this.prisma.category.findUnique({
      where: { id: params.categoryId },
      select: { verificationEnabled: true, title: true },
    });
    if (!category) {
      throw new BadRequestException('دسته‌بندی یافت نشد');
    }
    if (category.verificationEnabled === false) {
      if (params.type === ListingType.EXCHANGE) {
        throw new BadRequestException(
          `دسته «${category.title}» امکان کارشناسی ندارد؛ ثبت آگهی معاوضه برای این دسته مجاز نیست.`,
        );
      }
      throw new BadRequestException(
        `دسته «${category.title}» امکان کارشناسی ندارد؛ نمی‌توانید تضمین سلامت کالا را فعال کنید.`,
      );
    }
  }

  private async assertListingTypeEnabledForCreate(type: ListingType): Promise<void> {
    const enabled = await this.loadListingTypesEnabled();
    if (!isListingTypeEnabled(type, enabled)) {
      throw new BadRequestException(
        `ثبت آگهی ${listingTypePersianLabel(type)} در حال حاضر فعال نیست.`,
      );
    }
  }

  private validateListingPayload(
    dto: CreateListingDto | UpdateListingDto,
    isUpdate: boolean,
    resolvedType?: ListingType,
    isDraft = false,
  ): void {
    const type = resolvedType ?? dto.type;
    if (!type) {
      throw new BadRequestException(
        'نوع آگهی مشخص نیست. لطفاً نوع آگهی را انتخاب کنید.',
      );
    }

    const missing: string[] = [];
    const hasText = (v: unknown) =>
      typeof v === 'string' && v.trim().length > 0;

    if (!isUpdate || dto.title !== undefined) {
      if (!hasText(dto.title)) missing.push('عنوان آگهی');
    }
    if (isDraft) {
      if (missing.length) {
        throw new BadRequestException(
          `برای ذخیره پیش‌نویس، این موارد را تکمیل کنید: ${missing.join('، ')}`,
        );
      }
      return;
    }
    if (!isUpdate || dto.categoryId !== undefined) {
      if (!hasText(dto.categoryId)) missing.push('دسته‌بندی');
    }
    if (!isUpdate || dto.provinceId !== undefined) {
      if (!hasText(dto.provinceId)) missing.push('استان');
    }
    if (!isUpdate || dto.cityId !== undefined) {
      if (!hasText(dto.cityId)) missing.push('شهر');
    }

    const desc = String(dto.description ?? '').trim();
    if (!isUpdate || dto.description !== undefined) {
      if (desc.length < 80) {
        missing.push('توضیحات (حداقل ۸۰ کاراکتر)');
      }
    }
    if (!isUpdate) {
      const hasImage =
        Boolean(String(dto.thumbnail ?? '').trim()) ||
        (Array.isArray(dto.gallery) && dto.gallery.length > 0);
      if (!hasImage) missing.push('حداقل یک تصویر محصول');
    } else if (dto.gallery !== undefined) {
      const hasImage =
        Boolean(String(dto.thumbnail ?? '').trim()) ||
        (Array.isArray(dto.gallery) && dto.gallery.length > 0);
      if (!hasImage) missing.push('حداقل یک تصویر محصول');
    }

    if (type === ListingType.DIRECT) {
      const price = dto.direct?.price;
      if (price === undefined || Number(price) <= 0) {
        missing.push('قیمت فروش (باید بیشتر از صفر باشد)');
      }
    }

    if (
      type === ListingType.EXCHANGE ||
      (type === ListingType.DIRECT && dto.direct?.allowExchange)
    ) {
      if (!hasText(dto.exchange?.desiredTitle)) {
        missing.push('نام کالای درخواستی برای معاوضه');
      }
      if (!hasText(dto.exchange?.desiredCategoryId)) {
        missing.push('دسته‌بندی کالای درخواستی برای معاوضه');
      }
    }

    if (type === ListingType.AUCTION) {
      const basePrice = dto.auction?.basePrice;
      if (basePrice === undefined || Number(basePrice) <= 0) {
        missing.push('قیمت پایه مزایده (باید بیشتر از صفر باشد)');
      }
      if (!dto.auction?.endDatetime) {
        missing.push('زمان پایان مزایده');
      }
    }

    if (missing.length) {
      throw new BadRequestException(
        `برای ثبت آگهی، این موارد را تکمیل کنید: ${missing.join('، ')}`,
      );
    }
  }

  private shouldCreateExchange(dto: CreateListingDto): boolean {
    if (dto.type === ListingType.EXCHANGE) return true;
    if (dto.type === ListingType.DIRECT && dto.direct?.allowExchange)
      return true;
    return false;
  }

  private assertAuthorCanPublishListing(rating: unknown): void {
    const value = Number(rating);
    if (!Number.isFinite(value) || value < MIN_LISTING_AUTHOR_RATING) {
      throw new ForbiddenException(
        `با امتیاز کمتر از ${MIN_LISTING_AUTHOR_RATING} امکان ثبت یا ارسال مجدد آگهی ندارید.`,
      );
    }
  }

  private async ensureListingCanBeModified(
    listingId: string,
    userId: string,
    options?: { allowWordPressRestock?: boolean },
  ): Promise<Listing> {
    const listing = await this.prisma.listing.findUnique({
      where: { id: listingId },
    });
    if (!listing) throw new NotFoundException('آگهی یافت نشد');
    if (listing.authorId !== userId) {
      throw new ForbiddenException('شما مالک این آگهی نیستید');
    }
    if (listing.status === ListingStatus.SOLD) {
      if (
        options?.allowWordPressRestock &&
        isSyncableImportSource(listing.importSource)
      ) {
        return listing;
      }
      throw new BadRequestException('کالای فروخته شده قابل ویرایش یا حذف نیست');
    }

    const activeOrder = await this.prisma.order.findFirst({
      where: {
        listingId,
        status: {
          in: [
            OrderStatus.PENDING,
            OrderStatus.AWAITING_PAYMENT,
            OrderStatus.PAID,
            OrderStatus.AWAITING_SHIPMENT_TO_HUB,
            OrderStatus.SHIPPED_TO_HUB,
            OrderStatus.RECEIVED_AT_HUB,
            OrderStatus.CHECKING_AT_HUB,
            OrderStatus.VERIFIED_AT_HUB,
            OrderStatus.SHIPPED_TO_BUYER,
            OrderStatus.SHIPPED,
            OrderStatus.DELIVERED,
            OrderStatus.RETURN_REQUESTED,
            OrderStatus.RETURN_SHIPPED,
          ],
        },
      },
      select: { id: true },
    });
    if (activeOrder) {
      throw new BadRequestException(
        'این آگهی در جریان یک سفارش فعال است و قفل شده است.',
      );
    }

    if (listing.type === ListingType.AUCTION) {
      const bidCount = await this.prisma.auctionBid.count({
        where: { listingId },
      });
      if (bidCount > 0) {
        throw new BadRequestException(
          'روی این مزایده پیشنهاد مالی ثبت شده است و دیگر قابل تغییر یا حذف نیست.',
        );
      }
    }

    const acceptedExchange = await this.prisma.exchangeOffer.findFirst({
      where: { listingId, status: ExchangeOfferStatus.ACCEPTED },
      select: { id: true },
    });
    if (acceptedExchange) {
      throw new BadRequestException(
        'این آگهی در یک معامله معاوضه تایید شده قرار دارد و قفل شده است.',
      );
    }

    return listing;
  }

  private buildDirectCreateData(
    direct?: CreateListingDto['direct'],
  ): Prisma.ListingDirectCreateWithoutListingInput {
    const price = direct?.price ?? 0;
    const compareAtPrice = direct?.compareAtPrice ?? null;
    const salePrice = direct?.salePrice ?? null;
    if (salePrice != null) {
      try {
        validateListingSalePricing({ price, compareAtPrice, salePrice });
      } catch (e) {
        throw new BadRequestException(
          e instanceof Error ? e.message : 'قیمت ویژه نامعتبر است',
        );
      }
    }
    return {
      price,
      compareAtPrice,
      salePrice,
      allowExchange: direct?.allowExchange ?? false,
      shippingMethods: direct?.shippingMethods ?? [],
    };
  }

  private buildDirectUpsert(
    type: ListingType,
    dto: UpdateListingDto,
    current: { direct: { listingId: string } | null },
  ): Prisma.ListingDirectUpdateOneWithoutListingNestedInput | undefined {
    if (type === ListingType.DIRECT && dto.direct) {
      const data = this.buildDirectCreateData(dto.direct);
      return { upsert: { create: data, update: data } };
    }
    return current.direct ? { delete: true } : undefined;
  }

  private buildExchangeUpsert(
    type: ListingType,
    dto: UpdateListingDto,
    current: { exchange: { listingId: string } | null },
  ): Prisma.ListingExchangeUpdateOneWithoutListingNestedInput | undefined {
    const shouldKeep =
      (type === ListingType.EXCHANGE ||
        (type === ListingType.DIRECT && dto.direct?.allowExchange)) &&
      !!dto.exchange;

    if (shouldKeep && dto.exchange) {
      const data = {
        desiredCategoryId: dto.exchange.desiredCategoryId ?? '',
        desiredTitle: dto.exchange.desiredTitle ?? '',
        ownValue: dto.exchange.ownValue ?? 0,
        extraPaymentAmount: dto.exchange.extraPaymentAmount ?? 0,
      };
      return { upsert: { create: data, update: data } };
    }
    return current.exchange ? { delete: true } : undefined;
  }

  private buildAuctionUpsert(
    type: ListingType,
    dto: UpdateListingDto,
    current: { auction: { listingId: string } | null },
    endDate: Date | undefined,
  ): Prisma.ListingAuctionUpdateOneWithoutListingNestedInput | undefined {
    if (type === ListingType.AUCTION && dto.auction && endDate) {
      const data = {
        basePrice: dto.auction.basePrice ?? 0,
        minBidIncrement: dto.auction.minBidIncrement ?? 5000,
        endDatetime: endDate,
      };
      return { upsert: { create: data, update: data } };
    }
    return current.auction ? { delete: true } : undefined;
  }
}
