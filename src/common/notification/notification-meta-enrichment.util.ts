import { ListingType } from '@prisma/client';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { listingTypePersianLabel } from '../system-settings/listing-type-enabled';
import { resolveOrderStatusLabelFromMeta } from '../order/order-status-labels.util';
import {
  isListingTitleLikelyId,
  normalizeListingTitleInMeta,
} from './listing-title-meta.util';
import { formatUserDisplayName } from '../utils/user-display-name.util';

function formatUserName(
  user: { displayName?: string | null; firstName: string | null; lastName: string | null; phone: string } | null | undefined,
): string {
  return formatUserDisplayName(user, { fallback: 'phone' });
}

function formatAmount(value: unknown): string {
  const num = Number(value);
  if (!Number.isFinite(num)) return '';
  return num.toLocaleString('en-US');
}

function formatAmountFa(value: unknown): string {
  const num = Number(value);
  if (!Number.isFinite(num)) return '';
  return num.toLocaleString('fa-IR');
}

/**
 * غنی‌سازی meta برای placeholderهای پیامک/اعلان:
 * listingTitle، buyerName، sellerName، مبالغ و ...
 */
export async function enrichNotificationMeta(
  prisma: PrismaService,
  meta?: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  const out: Record<string, unknown> = { ...(meta ?? {}) };

  if (typeof out.listingId === 'string') {
    const listing = await prisma.listing.findUnique({
      where: { id: out.listingId },
      select: {
        title: true,
        type: true,
        authorId: true,
        author: { select: { id: true, firstName: true, lastName: true, displayName: true, phone: true } },
        direct: { select: { price: true } },
        auction: { select: { highestBidAmount: true, basePrice: true } },
      },
    });
    if (listing) {
      normalizeListingTitleInMeta(out, listing.title);
      if (!out.listingTitle) out.listingTitle = listing.title;
      if (!out.listingType) out.listingType = listing.type;
      if (!out.listingTypeFa) {
        out.listingTypeFa = listingTypePersianLabel(listing.type as ListingType);
      }
      if (!out.sellerId) out.sellerId = listing.authorId;
      if (!out.sellerName) out.sellerName = formatUserName(listing.author);
      if (!out.sellerPhone) out.sellerPhone = listing.author.phone;
      if (out.amount == null) {
        const price =
          listing.direct?.price ??
          listing.auction?.highestBidAmount ??
          listing.auction?.basePrice;
        if (price != null) out.amount = Number(price);
      }
    }
  }

  if (typeof out.orderId === 'string') {
    const order = await prisma.order.findUnique({
      where: { id: out.orderId },
      select: {
        type: true,
        status: true,
        listingId: true,
        buyerId: true,
        sellerId: true,
        exchangeOfferId: true,
        totalAmount: true,
        finalPrice: true,
        sellerRevenue: true,
        buyer: { select: { id: true, firstName: true, lastName: true, displayName: true, phone: true } },
        seller: { select: { id: true, firstName: true, lastName: true, displayName: true, phone: true } },
        listing: { select: { title: true } },
      },
    });
    if (order) {
      if (!out.listingId) out.listingId = order.listingId;
      if (!out.listingTitle && order.listing?.title) {
        out.listingTitle = order.listing.title;
      }
      normalizeListingTitleInMeta(out, order.listing?.title ?? null);
      if (!out.status) out.status = order.status;
      out.orderType = order.type;
      out.isExchange = order.type === 'EXCHANGE';
      out.buyerId = order.buyerId;
      out.sellerId = order.sellerId;
      out.buyerName = formatUserName(order.buyer);
      out.sellerName = formatUserName(order.seller);
      out.ownerName = formatUserName(order.seller);
      out.buyerPhone = order.buyer.phone;
      out.sellerPhone = order.seller.phone;
      out.totalAmount = Number(order.totalAmount);
      out.finalPrice = Number(order.finalPrice);
      out.sellerRevenue = Number(order.sellerRevenue);
      if (out.amount == null) out.amount = Number(order.totalAmount);

      if (!out.offerTitle && order.exchangeOfferId) {
        const offer = await prisma.exchangeOffer.findUnique({
          where: { id: order.exchangeOfferId },
          select: { title: true },
        });
        if (offer?.title) out.offerTitle = offer.title;
      }
    }
  }

  if (typeof out.offerId === 'string' && !out.offerTitle) {
    const offer = await prisma.exchangeOffer.findUnique({
      where: { id: out.offerId },
      select: {
        title: true,
        listing: { select: { title: true } },
      },
    });
    if (offer) {
      out.offerTitle = offer.title;
      if (!out.listingTitle && offer.listing?.title) {
        out.listingTitle = offer.listing.title;
      }
      normalizeListingTitleInMeta(out, offer.listing?.title ?? null);
    }
  }

  if (typeof out.userId === 'string' && (!out.userName || !out.userPhone)) {
    const user = await prisma.user.findUnique({
      where: { id: out.userId },
      select: { firstName: true, lastName: true, displayName: true, phone: true },
    });
    if (user) {
      if (!out.userName) out.userName = formatUserName(user);
      if (!out.userPhone) out.userPhone = user.phone;
    }
  }

  if (typeof out.transactionId === 'string' && out.amount == null) {
    const tx = await prisma.walletTransaction.findUnique({
      where: { id: out.transactionId },
      select: { amount: true },
    });
    if (tx) out.amount = Number(tx.amount);
  }

  if (out.amount != null && out.amountFormatted == null) {
    out.amountFormatted = formatAmountFa(out.amount);
  }
  if (out.totalAmount != null && out.totalAmountFormatted == null) {
    out.totalAmountFormatted = formatAmountFa(out.totalAmount);
  }
  if (out.refundAmount != null && out.refundAmountFormatted == null) {
    out.refundAmountFormatted = formatAmountFa(out.refundAmount);
  }

  if (typeof out.status === 'string' && out.status.trim()) {
    const statusLabel = resolveOrderStatusLabelFromMeta(out);
    out.statusLabel = statusLabel;
    out.orderStatusLabel = statusLabel;
    out.statusFa = statusLabel;
  }

  if (!out.ownerName && typeof out.sellerName === 'string') {
    out.ownerName = out.sellerName;
  }

  const sellerOrderStatusFa = resolvePartyOrderStatusFa(out, 'seller');
  const buyerOrderStatusFa = resolvePartyOrderStatusFa(out, 'buyer');
  if (sellerOrderStatusFa) {
    out.sellerOrderStatusFa = sellerOrderStatusFa;
    out.sellerOrderStatus = sellerOrderStatusFa;
    out.ownerOrderStatusFa = sellerOrderStatusFa;
  }
  if (buyerOrderStatusFa) {
    out.buyerOrderStatusFa = buyerOrderStatusFa;
    out.buyerOrderStatus = buyerOrderStatusFa;
  }

  return out;
}

function resolvePartyOrderStatusFa(
  meta: Record<string, unknown>,
  party: 'seller' | 'buyer',
): string {
  const roleKey = party === 'seller' ? 'SELLER' : 'BUYER';
  const noteKey = party === 'seller' ? 'sellerNote' : 'buyerNote';
  const statusKey = party === 'seller' ? 'sellerOrderStatusFa' : 'buyerOrderStatusFa';

  const explicit = meta[statusKey];
  if (typeof explicit === 'string' && explicit.trim()) return explicit.trim();

  const partyNote = meta[noteKey];
  if (typeof partyNote === 'string' && partyNote.trim()) return partyNote.trim();

  const role = String(meta.role ?? '').trim().toUpperCase();
  if (role === roleKey && typeof meta.note === 'string' && meta.note.trim()) {
    return meta.note.trim();
  }

  return resolveOrderStatusLabelFromMeta(meta);
}

/** meta نقش‌محور برای SMS/اعلان — note و buyerNote/sellerNote برای هر گیرنده */
export function buildPartyOrderNotifyMeta(
  role: 'BUYER' | 'SELLER',
  params: {
    buyerNote: string;
    sellerNote: string;
    extra?: Record<string, unknown>;
  },
): Record<string, unknown> {
  const buyerNote = params.buyerNote.trim();
  const sellerNote = params.sellerNote.trim();
  const note = role === 'BUYER' ? buyerNote : sellerNote;
  return {
    ...(params.extra ?? {}),
    role,
    audience: role,
    note,
    buyerNote,
    sellerNote,
  };
}

export function inferNotificationRecipientRole(
  meta?: Record<string, unknown>,
): string | undefined {
  const role = meta?.role;
  if (typeof role !== 'string') return undefined;
  const normalized = role.trim().toUpperCase();
  if (
    normalized === 'BUYER' ||
    normalized === 'SELLER' ||
    normalized === 'OWNER' ||
    normalized === 'OFFERER' ||
    normalized === 'USER' ||
    normalized === 'ADMIN'
  ) {
    return normalized;
  }
  return undefined;
}

export function buildNotificationRuleKey(
  type: string,
  recipientRole?: string,
): string {
  if (recipientRole) return `${type}@${recipientRole}`;
  return type;
}

function readMetaPhaseKey(meta?: Record<string, unknown>): string | undefined {
  const explicit =
    typeof meta?.phaseKey === 'string' ? meta.phaseKey.trim() : '';
  if (explicit) return explicit;
  const phase = typeof meta?.phase === 'string' ? meta.phase.trim() : '';
  const leg = typeof meta?.leg === 'string' ? meta.leg.trim() : '';
  if (!phase) return undefined;
  if (leg) return `${phase}_${leg}`;
  return phase;
}

/** اولویت جستجوی قانون SMS/اعلان: نقش+فاز → نقش → نوع پایه */
export function resolveNotificationRuleKeyCandidates(
  type: string,
  recipientRole?: string,
  meta?: Record<string, unknown>,
): string[] {
  const keys: string[] = [];
  const listingType =
    typeof meta?.listingType === 'string' ? meta.listingType.trim().toUpperCase() : '';
  if (listingType) {
    keys.push(`${type}@${listingType}`);
  }
  const phaseKey = readMetaPhaseKey(meta);
  if (phaseKey && recipientRole) {
    keys.push(`${type}@${recipientRole}@${phaseKey}`);
  }
  if (phaseKey) {
    keys.push(`${type}@${phaseKey}`);
    if (type === 'ACTION_DEADLINE_REMINDER') {
      const normalizedPhase = phaseKey.replace(/_(BUYER|SELLER)$/i, '');
      if (normalizedPhase !== phaseKey) {
        keys.push(`${type}@${normalizedPhase}`);
      }
    }
  }
  if (recipientRole) {
    keys.push(buildNotificationRuleKey(type, recipientRole));
  }
  keys.push(type);
  return [...new Set(keys)];
}
