import { BadRequestException } from '@nestjs/common';
import { ListingStatus, Prisma } from '@prisma/client';
import {
  resolveListingEffectiveUnitPrice,
  validateListingSalePricing,
} from './listing-price.util';

export const MAX_VARIATION_AXES = 3;
export const MAX_LISTING_VARIATIONS = 100;

export type VariationAttr = { name: string; value: string };
export type VariationAxis = { name: string; options: string[] };

export type VariationDraft = {
  id?: string;
  sku?: string | null;
  price: number;
  compareAtPrice?: number | null;
  salePrice?: number | null;
  stockQuantity: number;
  imageUrl?: string | null;
  attributes: VariationAttr[];
};

export type NormalizedVariation = VariationDraft & {
  attributeKey: string;
  sortOrder: number;
};

export function normalizeVariationText(value: unknown): string {
  return String(value ?? '')
    .trim()
    .replace(/\s+/g, ' ');
}

export function buildAttributeKey(attributes: VariationAttr[]): string {
  return [...attributes]
    .map((attr) => ({
      name: normalizeVariationText(attr.name),
      value: normalizeVariationText(attr.value),
    }))
    .filter((attr) => attr.name && attr.value)
    .sort((a, b) => a.name.localeCompare(b.name, 'fa'))
    .map((attr) => `${attr.name}=${attr.value}`)
    .join('|');
}

export function parseVariationAttributes(raw: unknown): VariationAttr[] {
  if (!Array.isArray(raw)) return [];
  const out: VariationAttr[] = [];
  for (const row of raw) {
    if (!row || typeof row !== 'object') continue;
    const record = row as Record<string, unknown>;
    const name = normalizeVariationText(record.name);
    const value = normalizeVariationText(record.value);
    if (!name || !value) continue;
    out.push({ name, value });
  }
  return out;
}

export function formatVariationLabel(raw: unknown): string {
  return parseVariationAttributes(raw)
    .map((attr) => `${attr.name}: ${attr.value}`)
    .join(' / ');
}

export function axesToAttributeJson(
  axes: VariationAxis[],
): Prisma.InputJsonValue {
  return axes.map((axis) => ({
    name: axis.name,
    slug: axis.name,
    visible: true,
    variation: true,
    options: axis.options,
  }));
}

export function normalizeVariableListing(input: {
  isDraft?: boolean;
  axes?: Array<{ name?: string; options?: string[] }>;
  variations?: Array<{
    id?: string;
    sku?: string | null;
    price?: number | null;
    compareAtPrice?: number | null;
    salePrice?: number | null;
    stockQuantity?: number | null;
    imageUrl?: string | null;
    attributes?: VariationAttr[];
  }>;
}): {
  axes: VariationAxis[];
  variations: NormalizedVariation[];
  direct: {
    price: number;
    compareAtPrice: number | null;
    salePrice: number | null;
  };
  stockQuantity: number;
  singleItemSale: boolean;
} {
  const isDraft = input.isDraft === true;
  const rawAxes = Array.isArray(input.axes) ? input.axes : [];
  const axes: VariationAxis[] = [];
  for (const axis of rawAxes) {
    const name = normalizeVariationText(axis?.name);
    const options = [
      ...new Set(
        (axis?.options ?? [])
          .map((option) => normalizeVariationText(option))
          .filter(Boolean),
      ),
    ];
    if (!name && options.length === 0) continue;
    if (!name) {
      throw new BadRequestException('نام ویژگی تنوع را وارد کنید');
    }
    if (options.length === 0) {
      throw new BadRequestException(`برای ویژگی «${name}» حداقل یک گزینه لازم است`);
    }
    if (axes.some((item) => item.name === name)) {
      throw new BadRequestException(`ویژگی «${name}» تکراری است`);
    }
    axes.push({ name, options });
  }

  if (axes.length > MAX_VARIATION_AXES) {
    throw new BadRequestException(
      `حداکثر ${MAX_VARIATION_AXES} ویژگی برای محصول متغیر مجاز است`,
    );
  }

  const rawVariations = Array.isArray(input.variations) ? input.variations : [];
  if (!isDraft && axes.length === 0) {
    throw new BadRequestException('حداقل یک ویژگی برای محصول متغیر لازم است');
  }
  if (!isDraft && rawVariations.length === 0) {
    throw new BadRequestException('حداقل یک تنوع با قیمت و موجودی بسازید');
  }
  if (rawVariations.length > MAX_LISTING_VARIATIONS) {
    throw new BadRequestException(
      `حداکثر ${MAX_LISTING_VARIATIONS} تنوع مجاز است`,
    );
  }

  const axisNames = axes.map((axis) => axis.name);
  const variations: NormalizedVariation[] = [];
  const seen = new Set<string>();

  rawVariations.forEach((row, index) => {
    const attributes = parseVariationAttributes(row.attributes);
    if (!isDraft && attributes.length === 0) {
      throw new BadRequestException('هر تنوع باید ویژگی داشته باشد');
    }
    if (axisNames.length) {
      const names = attributes.map((attr) => attr.name);
      if (
        names.length !== axisNames.length ||
        axisNames.some((name) => !names.includes(name))
      ) {
        throw new BadRequestException('ترکیب ویژگی‌های تنوع با تعریف ویژگی‌ها یکی نیست');
      }
      for (const attr of attributes) {
        const axis = axes.find((item) => item.name === attr.name);
        if (axis && !axis.options.includes(attr.value)) {
          throw new BadRequestException(
            `گزینه «${attr.value}» در ویژگی «${attr.name}» تعریف نشده است`,
          );
        }
      }
    }

    const price = Number(row.price ?? 0);
    const salePrice =
      row.salePrice != null && row.salePrice !== ('' as unknown)
        ? Number(row.salePrice)
        : null;
    const compareAtPrice =
      row.compareAtPrice != null ? Number(row.compareAtPrice) : null;
    const stockQuantity = Math.max(0, Math.floor(Number(row.stockQuantity ?? 0)));
    if (!isDraft) {
      try {
        validateListingSalePricing({
          price,
          compareAtPrice: compareAtPrice ?? price,
          salePrice: salePrice && salePrice > 0 ? salePrice : null,
        });
      } catch (error) {
        throw new BadRequestException(
          error instanceof Error ? error.message : 'قیمت تنوع نامعتبر است',
        );
      }
    }

    const attributeKey = buildAttributeKey(attributes) || `draft-${index}`;
    if (seen.has(attributeKey)) {
      throw new BadRequestException('دو تنوع با ترکیب ویژگی یکسان مجاز نیست');
    }
    seen.add(attributeKey);
    variations.push({
      id: row.id?.trim() || undefined,
      sku: normalizeVariationText(row.sku) || null,
      price: Number.isFinite(price) ? price : 0,
      compareAtPrice:
        compareAtPrice != null && Number.isFinite(compareAtPrice)
          ? compareAtPrice
          : null,
      salePrice:
        salePrice != null && Number.isFinite(salePrice) && salePrice > 0
          ? salePrice
          : null,
      stockQuantity,
      imageUrl: normalizeVariationText(row.imageUrl) || null,
      attributes,
      attributeKey,
      sortOrder: index,
    });
  });

  if (!variations.length) {
    return {
      axes,
      variations,
      direct: { price: 0, compareAtPrice: null, salePrice: null },
      stockQuantity: 0,
      singleItemSale: true,
    };
  }

  let best = variations[0];
  let bestEffective = resolveListingEffectiveUnitPrice(best);
  let stockQuantity = 0;
  for (const variation of variations) {
    stockQuantity += variation.stockQuantity;
    const effective = resolveListingEffectiveUnitPrice(variation);
    if (effective < bestEffective) {
      best = variation;
      bestEffective = effective;
    }
  }

  return {
    axes,
    variations,
    direct: {
      price: best.price,
      compareAtPrice: best.salePrice != null ? best.price : best.compareAtPrice,
      salePrice: best.salePrice,
    },
    stockQuantity,
    singleItemSale: variations.every((variation) => variation.stockQuantity <= 1),
  };
}

/** کسر موجودی فروش مستقیم؛ اگر تنوع باشد موجودی همان ترکیب و جمع والد به‌روز می‌شود. */
export async function decrementSoldStock(
  tx: Prisma.TransactionClient,
  input: { listingId: string; variationId?: string | null; quantity: number },
): Promise<void> {
  const quantity = Math.max(1, Math.floor(input.quantity || 1));
  if (input.variationId) {
    const updated = await tx.listingVariation.updateMany({
      where: {
        id: input.variationId,
        listingId: input.listingId,
        isActive: true,
        stockQuantity: { gte: quantity },
      },
      data: { stockQuantity: { decrement: quantity } },
    });
    if (updated.count !== 1) {
      throw new BadRequestException('موجودی این تنوع کافی نیست');
    }
    const sum = await tx.listingVariation.aggregate({
      where: { listingId: input.listingId, isActive: true },
      _sum: { stockQuantity: true },
    });
    const nextStock = Math.max(0, Number(sum._sum.stockQuantity ?? 0));
    await tx.listing.update({
      where: { id: input.listingId },
      data: {
        stockQuantity: nextStock,
        status: nextStock <= 0 ? ListingStatus.SOLD : ListingStatus.APPROVED,
      },
    });
    return;
  }

  const listing = await tx.listing.findUnique({
    where: { id: input.listingId },
    select: { stockQuantity: true },
  });
  const nextStock = Math.max(0, (listing?.stockQuantity ?? 1) - quantity);
  await tx.listing.update({
    where: { id: input.listingId },
    data: {
      stockQuantity: nextStock,
      status: nextStock <= 0 ? ListingStatus.SOLD : ListingStatus.APPROVED,
    },
  });
}
