import { Prisma } from '@prisma/client';
import {
  axesToAttributeJson,
  type NormalizedVariation,
  type VariationAxis,
} from './listing-variation.util';

type VariationWriter = {
  listingVariation: {
    findMany: (args: Prisma.ListingVariationFindManyArgs) => Promise<
      Array<{ id: string; attributeKey: string }>
    >;
    update: (args: Prisma.ListingVariationUpdateArgs) => Promise<unknown>;
    create: (args: Prisma.ListingVariationCreateArgs) => Promise<{ id: string }>;
    delete: (args: Prisma.ListingVariationDeleteArgs) => Promise<unknown>;
  };
  order: {
    count: (args: Prisma.OrderCountArgs) => Promise<number>;
  };
  cartItem: {
    deleteMany: (args: Prisma.CartItemDeleteManyArgs) => Promise<unknown>;
  };
  listing: {
    update: (args: Prisma.ListingUpdateArgs) => Promise<unknown>;
  };
};

export async function syncListingVariations(
  tx: VariationWriter,
  listingId: string,
  input: { isVariable: boolean; axes: VariationAxis[]; variations: NormalizedVariation[] },
): Promise<void> {
  const existing = await tx.listingVariation.findMany({
    where: { listingId },
    select: { id: true, attributeKey: true },
  });
  const byId = new Map(existing.map((row) => [row.id, row]));
  const byKey = new Map(existing.map((row) => [row.attributeKey, row]));

  if (!input.isVariable) {
    for (const row of existing) {
      await retireVariation(tx, row.id);
    }
    await tx.listing.update({
      where: { id: listingId },
      data: { isVariable: false, attributes: Prisma.DbNull },
    });
    return;
  }

  const kept = new Set<string>();
  for (const variation of input.variations) {
    const match =
      (variation.id ? byId.get(variation.id) : undefined) ??
      byKey.get(variation.attributeKey);
    const data = {
      sku: variation.sku,
      price: variation.price,
      compareAtPrice: variation.compareAtPrice,
      salePrice: variation.salePrice,
      stockQuantity: variation.stockQuantity,
      imageUrl: variation.imageUrl,
      attributes: variation.attributes as Prisma.InputJsonValue,
      attributeKey: variation.attributeKey,
      sortOrder: variation.sortOrder,
      isActive: true,
    };
    if (match) {
      await tx.listingVariation.update({
        where: { id: match.id },
        data,
      });
      kept.add(match.id);
    } else {
      const created = await tx.listingVariation.create({
        data: { listingId, ...data },
        select: { id: true },
      });
      kept.add(created.id);
    }
  }

  for (const row of existing) {
    if (!kept.has(row.id)) {
      await retireVariation(tx, row.id);
    }
  }

  await tx.listing.update({
    where: { id: listingId },
    data: {
      isVariable: true,
      attributes: axesToAttributeJson(input.axes),
    },
  });
}

async function retireVariation(tx: VariationWriter, variationId: string): Promise<void> {
  const orderCount = await tx.order.count({ where: { variationId } });
  if (orderCount > 0) {
    await tx.listingVariation.update({
      where: { id: variationId },
      data: { isActive: false, stockQuantity: 0 },
    });
    return;
  }
  await tx.cartItem.deleteMany({ where: { variationId } });
  await tx.listingVariation.delete({ where: { id: variationId } });
}
