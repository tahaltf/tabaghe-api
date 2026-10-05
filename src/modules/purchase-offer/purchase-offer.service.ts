import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import {
  ListingStatus,
  ListingType,
  Prisma,
  PurchaseOfferStatus,
  UserRole,
} from '@prisma/client';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { readPositiveIntSetting } from '../../common/system-settings/numeric-setting.util';
import {
  CreatePurchaseOfferDto,
  RejectPurchaseOfferDto,
} from './purchase-offer.dto';
import { PurchaseOfferEvents } from './purchase-offer.events';

const VALIDITY_HOURS_KEY = 'PURCHASE_OFFER_VALIDITY_HOURS';
const RESERVE_HOURS_KEY = 'PURCHASE_OFFER_CART_RESERVE_HOURS';
const DEFAULT_VALIDITY_HOURS = 48;
const DEFAULT_RESERVE_HOURS = 24;

@Injectable()
export class PurchaseOfferService {
  private readonly logger = new Logger(PurchaseOfferService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly eventEmitter: EventEmitter2,
  ) {}

  async createOffer(
    userId: string,
    listingId: string,
    dto: CreatePurchaseOfferDto,
  ) {
    const listing = await this.prisma.listing.findUnique({
      where: { id: listingId },
      select: {
        id: true,
        authorId: true,
        type: true,
        status: true,
        title: true,
        isVariable: true,
        direct: true,
      },
    });

    if (!listing) throw new NotFoundException('آگهی یافت نشد');
    if (listing.type !== ListingType.DIRECT) {
      throw new BadRequestException(
        'پیشنهاد خرید فقط برای آگهی فروش مستقیم مجاز است',
      );
    }
    if (listing.isVariable) {
      throw new BadRequestException(
        'برای محصول متغیر پیشنهاد خرید ثبت نمی‌شود؛ تنوع را انتخاب کنید و با قیمت همان تنوع بخرید',
      );
    }
    if (listing.status !== ListingStatus.APPROVED) {
      throw new BadRequestException('این آگهی قابل پیشنهاد نیست');
    }
    if (listing.authorId === userId) {
      throw new ForbiddenException(
        'نمی‌توانید برای آگهی خودتان پیشنهاد خرید ثبت کنید',
      );
    }
    if (!listing.direct) {
      throw new BadRequestException('قیمت آگهی یافت نشد');
    }

    const basePrice = Number(listing.direct.price);
    const amount = Number(dto.amount);
    if (!Number.isFinite(amount) || amount < 1) {
      throw new BadRequestException('مبلغ پیشنهاد نامعتبر است');
    }
    if (amount >= basePrice) {
      throw new BadRequestException(
        'مبلغ پیشنهاد باید کمتر از قیمت آگهی باشد',
      );
    }

    const province = String(dto.province ?? '').trim();
    const city = String(dto.city ?? '').trim();
    if (!province || !city) {
      throw new BadRequestException('استان و شهر الزامی است');
    }

    const active = await this.prisma.purchaseOffer.findFirst({
      where: {
        buyerId: userId,
        listingId,
        status: {
          in: [PurchaseOfferStatus.PENDING, PurchaseOfferStatus.ACCEPTED],
        },
      },
    });
    if (active) {
      throw new BadRequestException(
        'شما قبلاً برای این آگهی پیشنهاد فعال دارید',
      );
    }

    const reserved = await this.findActiveReservation(listingId);
    if (reserved && reserved.buyerId !== userId) {
      throw new BadRequestException(
        'این کالا فعلاً برای خریدار دیگری رزرو شده است',
      );
    }

    const validityHours = await readPositiveIntSetting(
      this.prisma,
      VALIDITY_HOURS_KEY,
      DEFAULT_VALIDITY_HOURS,
    );
    const expiresAt = new Date(Date.now() + validityHours * 60 * 60 * 1000);

    const offer = await this.prisma.purchaseOffer.create({
      data: {
        listingId,
        buyerId: userId,
        amount,
        description: dto.description?.trim() || null,
        province,
        city,
        status: PurchaseOfferStatus.PENDING,
        expiresAt,
      },
    });

    this.eventEmitter.emit(PurchaseOfferEvents.OFFER_CREATED, {
      listingId,
      ownerId: listing.authorId,
      buyerId: userId,
      offerId: offer.id,
      amount,
      amountFormatted: amount.toLocaleString('fa-IR'),
      listingTitle: listing.title,
    });

    return this.serializeOffer(offer, { hideBuyer: true });
  }

  async getMyOffer(userId: string, listingId: string) {
    const offer = await this.prisma.purchaseOffer.findFirst({
      where: { buyerId: userId, listingId },
      orderBy: { createdAt: 'desc' },
    });
    if (!offer) return null;
    return this.serializeOffer(offer, { hideBuyer: true });
  }

  async getOffers(
    userId: string,
    listingId: string,
    options: { page?: number; pageSize?: number } = {},
  ) {
    const page = Math.max(1, options.page ?? 1);
    const pageSize = Math.min(50, Math.max(1, options.pageSize ?? 20));
    const skip = (page - 1) * pageSize;

    const listing = await this.prisma.listing.findUnique({
      where: { id: listingId },
      select: { authorId: true },
    });
    if (!listing) throw new NotFoundException('آگهی یافت نشد');

    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { role: true },
    });
    const isStaff =
      user?.role === UserRole.ADMIN || user?.role === UserRole.GODADMIN;
    const isOwner = listing.authorId === userId;

    if (!isOwner && !isStaff) {
      throw new ForbiddenException('دسترسی ندارید');
    }

    const where: Prisma.PurchaseOfferWhereInput = { listingId };
    const buyerSelect = {
      id: true,
      firstName: true,
      lastName: true,
      displayName: true,
      phone: true,
    } as const;
    const [items, total] = await Promise.all([
      this.prisma.purchaseOffer.findMany({
        where,
        skip,
        take: pageSize,
        orderBy: [{ amount: 'desc' }, { createdAt: 'desc' }],
        include: {
          buyer: { select: buyerSelect },
        },
      }),
      this.prisma.purchaseOffer.count({ where }),
    ]);

    return {
      items: items.map((o) =>
        this.serializeOffer(o, {
          hideBuyer: false,
          includeBuyer: true,
        }),
      ),
      pagination: {
        page,
        pageSize,
        total,
        totalPages: Math.max(1, Math.ceil(total / pageSize)),
      },
    };
  }

  async acceptOffer(userId: string, offerId: string) {
    const result = await this.prisma.$transaction(async (tx) => {
      const offer = await tx.purchaseOffer.findUnique({
        where: { id: offerId },
        include: {
          listing: {
            select: {
              id: true,
              authorId: true,
              type: true,
              status: true,
              title: true,
              stockQuantity: true,
              singleItemSale: true,
              direct: true,
            },
          },
        },
      });

      if (!offer) throw new NotFoundException('پیشنهاد یافت نشد');
      if (offer.listing.authorId !== userId) {
        throw new ForbiddenException('فقط مالک آگهی می‌تواند تأیید کند');
      }
      if (offer.listing.type !== ListingType.DIRECT) {
        throw new BadRequestException('این آگهی فروش مستقیم نیست');
      }
      if (offer.listing.status !== ListingStatus.APPROVED) {
        throw new BadRequestException('آگهی قابل فروش نیست');
      }
      if (offer.status !== PurchaseOfferStatus.PENDING) {
        throw new BadRequestException('این پیشنهاد قابل تأیید نیست');
      }
      if (offer.expiresAt.getTime() <= Date.now()) {
        await tx.purchaseOffer.update({
          where: { id: offer.id },
          data: { status: PurchaseOfferStatus.EXPIRED },
        });
        throw new BadRequestException('مهلت این پیشنهاد به پایان رسیده است');
      }

      const existingReservation = await this.findActiveReservation(
        offer.listingId,
        tx,
      );
      if (existingReservation) {
        throw new BadRequestException(
          'این کالا هم‌اکنون برای خریدار دیگری رزرو شده است',
        );
      }

      if ((offer.listing.stockQuantity ?? 1) <= 0) {
        throw new BadRequestException('موجودی این کالا تمام شده است');
      }

      const direct = offer.listing.direct;
      if (!direct) throw new BadRequestException('قیمت آگهی یافت نشد');

      const amount = Number(offer.amount);
      const basePrice = Number(direct.price);
      if (amount >= basePrice) {
        throw new BadRequestException(
          'مبلغ پیشنهاد باید کمتر از قیمت آگهی باشد',
        );
      }

      const reserveHours = await readPositiveIntSetting(
        tx,
        RESERVE_HOURS_KEY,
        DEFAULT_RESERVE_HOURS,
      );
      const now = new Date();
      const reservedUntil = new Date(
        now.getTime() + reserveHours * 60 * 60 * 1000,
      );

      const prevSalePrice =
        direct.salePrice != null ? Number(direct.salePrice) : null;
      const prevCompareAtPrice =
        direct.compareAtPrice != null ? Number(direct.compareAtPrice) : null;

      await tx.listingDirect.update({
        where: { listingId: offer.listingId },
        data: {
          salePrice: amount,
          compareAtPrice: direct.compareAtPrice ?? direct.price,
        },
      });

      await tx.purchaseOffer.updateMany({
        where: {
          listingId: offer.listingId,
          status: PurchaseOfferStatus.PENDING,
          id: { not: offer.id },
        },
        data: { status: PurchaseOfferStatus.EXPIRED },
      });

      const updated = await tx.purchaseOffer.update({
        where: { id: offer.id },
        data: {
          status: PurchaseOfferStatus.ACCEPTED,
          acceptedAt: now,
          reservedUntil,
          prevSalePrice,
          prevCompareAtPrice,
        },
      });

      let cart = await tx.cart.findUnique({
        where: { userId: offer.buyerId },
      });
      if (!cart) {
        cart = await tx.cart.create({
          data: {
            userId: offer.buyerId,
            sellerId: offer.listing.authorId,
          },
        });
      } else if (cart.sellerId !== offer.listing.authorId) {
        const oldOfferItems = await tx.cartItem.findMany({
          where: {
            cartId: cart.id,
            purchaseOfferId: { not: null },
          },
          select: { purchaseOfferId: true },
        });
        for (const old of oldOfferItems) {
          if (!old.purchaseOfferId) continue;
          const prev = await tx.purchaseOffer.findUnique({
            where: { id: old.purchaseOfferId },
            include: { listing: { select: { direct: true } } },
          });
          if (prev?.status === PurchaseOfferStatus.ACCEPTED && prev.listing.direct) {
            const currentSale =
              prev.listing.direct.salePrice != null
                ? Number(prev.listing.direct.salePrice)
                : null;
            if (currentSale != null && currentSale === Number(prev.amount)) {
              await tx.listingDirect.update({
                where: { listingId: prev.listingId },
                data: {
                  salePrice: prev.prevSalePrice,
                  compareAtPrice: prev.prevCompareAtPrice,
                },
              });
            }
            await tx.purchaseOffer.update({
              where: { id: prev.id },
              data: {
                status: PurchaseOfferStatus.CANCELLED,
                reservedUntil: null,
              },
            });
          }
        }
        await tx.cartItem.deleteMany({ where: { cartId: cart.id } });
        cart = await tx.cart.update({
          where: { id: cart.id },
          data: { sellerId: offer.listing.authorId },
        });
      }

      await tx.cartItem.upsert({
        where: {
          cartId_listingId_variationKey: {
            cartId: cart.id,
            listingId: offer.listingId,
            variationKey: '',
          },
        },
        create: {
          cartId: cart.id,
          listingId: offer.listingId,
          variationKey: '',
          quantity: 1,
          purchaseOfferId: offer.id,
          lockedUnitPrice: amount,
          reservedUntil,
        },
        update: {
          quantity: 1,
          purchaseOfferId: offer.id,
          lockedUnitPrice: amount,
          reservedUntil,
        },
      });

      return {
        offer: updated,
        listingTitle: offer.listing.title,
        buyerId: offer.buyerId,
        listingId: offer.listingId,
      };
    });

    this.eventEmitter.emit(PurchaseOfferEvents.OFFER_ACCEPTED, {
      listingId: result.listingId,
      buyerId: result.buyerId,
      offerId: result.offer.id,
      amount: Number(result.offer.amount),
      amountFormatted: Number(result.offer.amount).toLocaleString('fa-IR'),
      listingTitle: result.listingTitle,
      listingUrl: `/listing/${result.listingId}`,
    });

    return this.serializeOffer(result.offer, { hideBuyer: true });
  }

  async rejectOffer(
    userId: string,
    offerId: string,
    dto: RejectPurchaseOfferDto,
  ) {
    const offer = await this.prisma.purchaseOffer.findUnique({
      where: { id: offerId },
      include: {
        listing: { select: { authorId: true, title: true } },
      },
    });
    if (!offer) throw new NotFoundException('پیشنهاد یافت نشد');
    if (offer.listing.authorId !== userId) {
      throw new ForbiddenException('فقط مالک آگهی می‌تواند رد کند');
    }
    if (offer.status !== PurchaseOfferStatus.PENDING) {
      throw new BadRequestException('این پیشنهاد قابل رد نیست');
    }

    const reason = dto.reason?.trim();
    if (!reason) {
      throw new BadRequestException('علت رد الزامی است');
    }

    const updated = await this.prisma.purchaseOffer.update({
      where: { id: offer.id },
      data: {
        status: PurchaseOfferStatus.REJECTED,
        rejectionReason: reason,
      },
    });

    this.eventEmitter.emit(PurchaseOfferEvents.OFFER_REJECTED, {
      listingId: offer.listingId,
      buyerId: offer.buyerId,
      offerId: offer.id,
      reason,
      listingTitle: offer.listing.title,
    });

    return this.serializeOffer(updated, { hideBuyer: true });
  }

  /**
   * آزادسازی رزرو: بازگردانی قیمت + حذف قفل سبد + وضعیت CANCELLED
   */
  async releaseReservation(
    offerId: string,
    reason: 'expired' | 'cancelled' | 'removed_from_cart' = 'cancelled',
  ) {
    await this.prisma.$transaction(async (tx) => {
      const offer = await tx.purchaseOffer.findUnique({
        where: { id: offerId },
        include: { listing: { select: { direct: true } } },
      });
      if (!offer) return;
      if (offer.status !== PurchaseOfferStatus.ACCEPTED) return;

      const direct = offer.listing.direct;
      if (direct) {
        const currentSale =
          direct.salePrice != null ? Number(direct.salePrice) : null;
        const offerAmount = Number(offer.amount);
        // فقط اگر هنوز همان قیمت پیشنهاد روی آگهی است، restore کن
        if (currentSale != null && currentSale === offerAmount) {
          await tx.listingDirect.update({
            where: { listingId: offer.listingId },
            data: {
              salePrice: offer.prevSalePrice,
              compareAtPrice: offer.prevCompareAtPrice,
            },
          });
        }
      }

      await tx.cartItem.deleteMany({
        where: { purchaseOfferId: offer.id },
      });

      await tx.purchaseOffer.update({
        where: { id: offer.id },
        data: {
          status:
            reason === 'expired'
              ? PurchaseOfferStatus.EXPIRED
              : PurchaseOfferStatus.CANCELLED,
          reservedUntil: null,
        },
      });
    });
  }

  async expirePendingOffers() {
    const now = new Date();
    const result = await this.prisma.purchaseOffer.updateMany({
      where: {
        status: PurchaseOfferStatus.PENDING,
        expiresAt: { lt: now },
      },
      data: { status: PurchaseOfferStatus.EXPIRED },
    });
    if (result.count > 0) {
      this.logger.log(`Expired ${result.count} pending purchase offers`);
    }
  }

  async expireAcceptedReservations() {
    const now = new Date();
    const expired = await this.prisma.purchaseOffer.findMany({
      where: {
        status: PurchaseOfferStatus.ACCEPTED,
        reservedUntil: { lt: now },
      },
      select: { id: true },
      take: 100,
    });
    for (const row of expired) {
      try {
        await this.releaseReservation(row.id, 'expired');
      } catch (err) {
        this.logger.error(
          `Failed to release purchase offer reservation ${row.id}`,
          err instanceof Error ? err.stack : undefined,
        );
      }
    }
  }

  async findActiveReservation(
    listingId: string,
    client: Prisma.TransactionClient | PrismaService = this.prisma,
  ) {
    const now = new Date();
    return client.purchaseOffer.findFirst({
      where: {
        listingId,
        status: PurchaseOfferStatus.ACCEPTED,
        reservedUntil: { gt: now },
      },
      select: {
        id: true,
        buyerId: true,
        reservedUntil: true,
        amount: true,
      },
    });
  }

  async isListingReservedForOther(
    listingId: string,
    viewerId?: string | null,
  ): Promise<boolean> {
    const reservation = await this.findActiveReservation(listingId);
    if (!reservation) return false;
    if (viewerId && reservation.buyerId === viewerId) return false;
    return true;
  }

  async clearReservationAfterSuccessfulCheckout(
    buyerId: string,
    listingIds: string[],
  ) {
    if (!listingIds.length) return;
    const offers = await this.prisma.purchaseOffer.findMany({
      where: {
        buyerId,
        listingId: { in: listingIds },
        status: PurchaseOfferStatus.ACCEPTED,
      },
      select: { id: true },
    });
    for (const offer of offers) {
      await this.prisma.$transaction(async (tx) => {
        await tx.cartItem.updateMany({
          where: { purchaseOfferId: offer.id },
          data: {
            purchaseOfferId: null,
            lockedUnitPrice: null,
            reservedUntil: null,
          },
        });
        await tx.purchaseOffer.update({
          where: { id: offer.id },
          data: {
            reservedUntil: null,
            // ACCEPTED می‌ماند؛ معامله موفق
          },
        });
      });
    }
  }

  private serializeOffer(
    offer: {
      id: string;
      listingId: string;
      buyerId: string;
      amount: Prisma.Decimal | number;
      description: string | null;
      province?: string | null;
      city?: string | null;
      status: PurchaseOfferStatus;
      rejectionReason: string | null;
      expiresAt: Date;
      acceptedAt: Date | null;
      reservedUntil: Date | null;
      createdAt: Date;
      updatedAt: Date;
      buyer?: unknown;
    },
    opts: { hideBuyer?: boolean; includeBuyer?: boolean } = {},
  ) {
    const base: Record<string, unknown> = {
      id: offer.id,
      listingId: offer.listingId,
      amount: Number(offer.amount),
      description: offer.description,
      province: offer.province ?? null,
      city: offer.city ?? null,
      status: offer.status,
      rejectionReason: offer.rejectionReason,
      expiresAt: offer.expiresAt,
      acceptedAt: offer.acceptedAt,
      reservedUntil: offer.reservedUntil,
      createdAt: offer.createdAt,
      updatedAt: offer.updatedAt,
      canAccept:
        offer.status === PurchaseOfferStatus.PENDING &&
        offer.expiresAt.getTime() > Date.now(),
      canReject:
        offer.status === PurchaseOfferStatus.PENDING &&
        offer.expiresAt.getTime() > Date.now(),
      isExpired:
        offer.status === PurchaseOfferStatus.EXPIRED ||
        (offer.status === PurchaseOfferStatus.PENDING &&
          offer.expiresAt.getTime() <= Date.now()),
    };
    if (opts.includeBuyer && offer.buyer) {
      base.buyer = offer.buyer;
      base.buyerId = offer.buyerId;
    } else if (!opts.hideBuyer) {
      base.buyerId = offer.buyerId;
    }
    return base;
  }
}
