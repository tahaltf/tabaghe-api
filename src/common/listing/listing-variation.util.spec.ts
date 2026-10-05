import { BadRequestException } from '@nestjs/common';
import { ListingStatus } from '@prisma/client';
import {
  buildAttributeKey,
  decrementSoldStock,
  formatVariationLabel,
  normalizeVariableListing,
} from './listing-variation.util';

describe('listing variations', () => {
  it('builds a stable attribute key and label', () => {
    expect(
      buildAttributeKey([
        { name: ' سایز ', value: 'L' },
        { name: 'رنگ', value: 'قرمز' },
      ]),
    ).toBe('رنگ=قرمز|سایز=L');
    expect(
      formatVariationLabel([
        { name: 'رنگ', value: 'قرمز' },
        { name: 'سایز', value: 'L' },
      ]),
    ).toBe('رنگ: قرمز / سایز: L');
  });

  it('uses the minimum effective price and sums stock', () => {
    const plan = normalizeVariableListing({
      axes: [
        { name: 'رنگ', options: ['قرمز', 'آبی'] },
      ],
      variations: [
        {
          price: 200_000,
          salePrice: 150_000,
          stockQuantity: 2,
          attributes: [{ name: 'رنگ', value: 'قرمز' }],
        },
        {
          price: 90_000,
          stockQuantity: 1,
          attributes: [{ name: 'رنگ', value: 'آبی' }],
        },
      ],
    });

    expect(plan.direct.price).toBe(90_000);
    expect(plan.direct.salePrice).toBeNull();
    expect(plan.stockQuantity).toBe(3);
    expect(plan.singleItemSale).toBe(false);
    expect(plan.variations).toHaveLength(2);
  });

  it('rejects a variable listing without attributes', () => {
    expect(() =>
      normalizeVariableListing({
        axes: [],
        variations: [],
      }),
    ).toThrow(BadRequestException);
  });

  it('decrements only the selected variation and recomputes parent stock', async () => {
    const updateMany = jest.fn().mockResolvedValue({ count: 1 });
    const aggregate = jest.fn().mockResolvedValue({ _sum: { stockQuantity: 4 } });
    const listingUpdate = jest.fn().mockResolvedValue({});
    await decrementSoldStock(
      {
        listingVariation: { updateMany, aggregate },
        listing: {
          findUnique: jest.fn(),
          update: listingUpdate,
        },
      } as never,
      { listingId: 'listing-1', variationId: 'var-red', quantity: 1 },
    );

    expect(updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ id: 'var-red', stockQuantity: { gte: 1 } }),
      }),
    );
    expect(listingUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          stockQuantity: 4,
          status: ListingStatus.APPROVED,
        }),
      }),
    );
  });
});
