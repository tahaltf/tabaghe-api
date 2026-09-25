import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { ListingStatus, ListingType, Prisma } from '@prisma/client';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { resolveListingEffectiveUnitPrice } from '../../common/listing/listing-price.util';
import { formatUserDisplayName } from '../../common/utils/user-display-name.util';

const CART_LISTING_INCLUDE = {
  author: { select: { id: true, firstName: true, lastName: true, displayName: true } },
  category: { select: { id: true, title: true, verificationEnabled: true } },
  direct: true,
} satisfies Prisma.ListingInclude;

@Injectable()
export class CartService {
  constructor(private readonly prisma: PrismaService) {}

  async getCart(userId: string) {
    const cart = await this.prisma.cart.findUnique({
      where: { userId },
      include: {
        items: { orderBy: { createdAt: 'asc' } },
      },
    });
    if (!cart || cart.items.length === 0) {
      return { sellerId: null, sellerName: null, items: [], itemCount: 0 };
    }
    const listingIds = cart.items.map((i) => i.listingId);
    const listings = await this.prisma.listing.findMany({
      where: { id: { in: listingIds } },
      include: CART_LISTING_INCLUDE,
    });
    const listingMap = new Map(listings.map((l) => [l.id, l]));
    const seller = listings[0]?.author;
    const items = cart.items
      .map((item) => {
        const listing = listingMap.get(item.listingId);
        if (!listing) return null;
        const unitPrice = listing.direct
          ? resolveListingEffectiveUnitPrice(listing.direct)
          : 0;
        const maxQty = this.resolveMaxQuantity(listing);
        return {
          listingId: item.listingId,
          quantity: Math.min(item.quantity, maxQty),
          maxQuantity: maxQty,
          unitPrice,
          lineTotal: unitPrice * Math.min(item.quantity, maxQty),
          listing: {
            id: listing.id,
            title: listing.title,
            thumbnail: listing.thumbnail,
            status: listing.status,
            stockQuantity: listing.stockQuantity,
            singleItemSale: listing.singleItemSale,
            shippingPayer: listing.shippingPayer,
            direct: listing.direct
              ? {
                  price: Number(listing.direct.price),
                  compareAtPrice: listing.direct.compareAtPrice
                    ? Number(listing.direct.compareAtPrice)
                    : null,
                  salePrice: listing.direct.salePrice
                    ? Number(listing.direct.salePrice)
                    : null,
                }
              : null,
            author: listing.author,
            category: listing.category,
          },
        };
      })
      .filter(Boolean);
    return {
      sellerId: cart.sellerId,
      sellerName: seller ? formatUserDisplayName(seller) || null : null,
      items,
      itemCount: items.reduce((s, i) => s + (i?.quantity ?? 0), 0),
    };
  }

  async addItem(userId: string, listingId: string, quantity = 1) {
    const listing = await this.prisma.listing.findUnique({
      where: { id: listingId },
      include: { direct: true, author: { select: { id: true } } },
    });
    if (!listing || listing.type !== ListingType.DIRECT) {
      throw new BadRequestException('فقط آگهی فروش مستقیم به سبد اضافه می‌شود');
    }
    if (listing.status !== ListingStatus.APPROVED) {
      throw new BadRequestException('این آگهی قابل خرید نیست');
    }
    if (listing.authorId === userId) {
      throw new BadRequestException('نمی‌توانید آگهی خودتان را بخرید');
    }
    const maxQty = this.resolveMaxQuantity(listing);
    if (maxQty <= 0) {
      throw new BadRequestException('موجودی این کالا تمام شده است');
    }
    const qty = Math.min(Math.max(1, quantity), maxQty);

    let cart = await this.prisma.cart.findUnique({ where: { userId } });
    if (!cart) {
      cart = await this.prisma.cart.create({
        data: { userId, sellerId: listing.authorId },
      });
    } else if (cart.sellerId !== listing.authorId) {
      throw new BadRequestException(
        'سبد خرید شما از فروشنده دیگری است. ابتدا سبد را خالی کنید یا خرید را تکمیل کنید.',
      );
    }

    const existing = await this.prisma.cartItem.findUnique({
      where: { cartId_listingId: { cartId: cart.id, listingId } },
    });
    const newQty = Math.min(
      maxQty,
      (existing?.quantity ?? 0) + qty,
    );

    await this.prisma.cartItem.upsert({
      where: {
        cartId_listingId: { cartId: cart.id, listingId },
      },
      create: { cartId: cart.id, listingId, quantity: newQty },
      update: { quantity: newQty },
    });

    return this.getCart(userId);
  }

  async updateItemQuantity(
    userId: string,
    listingId: string,
    quantity: number,
  ) {
    const cart = await this.requireCart(userId);
    const item = await this.prisma.cartItem.findUnique({
      where: { cartId_listingId: { cartId: cart.id, listingId } },
    });
    if (!item) throw new NotFoundException('آیتم در سبد یافت نشد');

    const listing = await this.prisma.listing.findUnique({
      where: { id: listingId },
    });
    if (!listing) throw new NotFoundException('آگهی یافت نشد');
    const maxQty = this.resolveMaxQuantity(listing);
    const qty = Math.min(Math.max(1, quantity), maxQty);

    await this.prisma.cartItem.update({
      where: { id: item.id },
      data: { quantity: qty },
    });
    return this.getCart(userId);
  }

  async removeItem(userId: string, listingId: string) {
    const cart = await this.requireCart(userId);
    await this.prisma.cartItem.deleteMany({
      where: { cartId: cart.id, listingId },
    });
    await this.pruneEmptyCart(cart.id);
    return this.getCart(userId);
  }

  async clearCart(userId: string) {
    const cart = await this.prisma.cart.findUnique({ where: { userId } });
    if (cart) {
      await this.prisma.cartItem.deleteMany({ where: { cartId: cart.id } });
      await this.prisma.cart.delete({ where: { id: cart.id } });
    }
    return { sellerId: null, sellerName: null, items: [], itemCount: 0 };
  }

  async requireCartItems(userId: string) {
    const cart = await this.requireCart(userId);
    const items = await this.prisma.cartItem.findMany({
      where: { cartId: cart.id },
      orderBy: { createdAt: 'asc' },
    });
    if (!items.length) {
      throw new BadRequestException('سبد خرید خالی است');
    }
    return { cart, items };
  }

  private async requireCart(userId: string) {
    const cart = await this.prisma.cart.findUnique({ where: { userId } });
    if (!cart) throw new NotFoundException('سبد خرید یافت نشد');
    return cart;
  }

  private async pruneEmptyCart(cartId: string) {
    const count = await this.prisma.cartItem.count({ where: { cartId } });
    if (count === 0) {
      await this.prisma.cart.delete({ where: { id: cartId } });
    }
  }

  private resolveMaxQuantity(listing: {
    stockQuantity: number;
    singleItemSale: boolean;
  }): number {
    const stock = listing.stockQuantity ?? 1;
    if (listing.singleItemSale !== false) return stock > 0 ? 1 : 0;
    return Math.max(0, stock);
  }
}
