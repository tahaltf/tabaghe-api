import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { resolveOrderStatusLabelFromMeta } from '../order/order-status-labels.util';

function formatUserName(
  user: { firstName: string | null; lastName: string | null; phone: string } | null | undefined,
): string {
  if (!user) return '';
  const name = `${user.firstName ?? ''} ${user.lastName ?? ''}`.trim();
  return name || user.phone;
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
        authorId: true,
        author: { select: { id: true, firstName: true, lastName: true, phone: true } },
        direct: { select: { price: true } },
        auction: { select: { highestBidAmount: true, basePrice: true } },
      },
    });
    if (listing) {
      if (!out.listingTitle) out.listingTitle = listing.title;
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
        listingId: true,
        buyerId: true,
        sellerId: true,
        totalAmount: true,
        finalPrice: true,
        sellerRevenue: true,
        buyer: { select: { id: true, firstName: true, lastName: true, phone: true } },
        seller: { select: { id: true, firstName: true, lastName: true, phone: true } },
        listing: { select: { title: true } },
      },
    });
    if (order) {
      if (!out.listingId) out.listingId = order.listingId;
      if (!out.listingTitle && order.listing?.title) {
        out.listingTitle = order.listing.title;
      }
      out.buyerId = order.buyerId;
      out.sellerId = order.sellerId;
      out.buyerName = formatUserName(order.buyer);
      out.sellerName = formatUserName(order.seller);
      out.buyerPhone = order.buyer.phone;
      out.sellerPhone = order.seller.phone;
      out.totalAmount = Number(order.totalAmount);
      out.finalPrice = Number(order.finalPrice);
      out.sellerRevenue = Number(order.sellerRevenue);
      if (out.amount == null) out.amount = Number(order.totalAmount);
    }
  }

  if (typeof out.userId === 'string' && (!out.userName || !out.userPhone)) {
    const user = await prisma.user.findUnique({
      where: { id: out.userId },
      select: { firstName: true, lastName: true, phone: true },
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

  return out;
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
  const phaseKey = readMetaPhaseKey(meta);
  if (phaseKey && recipientRole) {
    keys.push(`${type}@${recipientRole}@${phaseKey}`);
  }
  if (phaseKey) {
    keys.push(`${type}@${phaseKey}`);
  }
  if (recipientRole) {
    keys.push(buildNotificationRuleKey(type, recipientRole));
  }
  keys.push(type);
  return [...new Set(keys)];
}
