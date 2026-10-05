import { ValidationPipe } from '@nestjs/common';
import { WordPressProductBulkDto, WordPressProductDto } from './wordpress-product.dto';

const pipe = new ValidationPipe({
  whitelist: true,
  forbidNonWhitelisted: true,
  transform: true,
  transformOptions: { enableImplicitConversion: true },
});

const baseProduct = {
  externalProductId: '123',
  siteUrl: 'https://example.com/',
  title: 'Test product',
  description: 'Desc',
  price: 1000,
  images: [{ url: 'https://example.com/img.jpg' }],
  attributes: [],
};

describe('WordPressProductDto validation', () => {
  it('accepts null stockQuantity', async () => {
    await expect(
      pipe.transform({ ...baseProduct, stockQuantity: null }, {
        type: 'body',
        metatype: WordPressProductDto,
      }),
    ).resolves.toBeDefined();
  });

  it('normalizes negative stockQuantity to null', async () => {
    const result = await pipe.transform({ ...baseProduct, stockQuantity: -1 }, {
      type: 'body',
      metatype: WordPressProductDto,
    });
    expect(result.stockQuantity).toBeNull();
  });

  it('accepts string stockQuantity with implicit conversion', async () => {
    const result = await pipe.transform({ ...baseProduct, stockQuantity: '5' }, {
      type: 'body',
      metatype: WordPressProductDto,
    });
    expect(result.stockQuantity).toBe(5);
  });

  it('accepts bulk payload', async () => {
    await expect(
      pipe.transform({ products: [{ ...baseProduct, stockQuantity: null }] }, {
        type: 'body',
        metatype: WordPressProductBulkDto,
      }),
    ).resolves.toBeDefined();
  });

  it('accepts optional priceCurrencyCode and normalizes to uppercase', async () => {
    const result = await pipe.transform(
      { ...baseProduct, priceCurrencyCode: ' usd ' },
      {
        type: 'body',
        metatype: WordPressProductDto,
      },
    );
    expect(result.priceCurrencyCode).toBe('USD');
  });

  it('omits empty priceCurrencyCode', async () => {
    const result = await pipe.transform(
      { ...baseProduct, priceCurrencyCode: '' },
      {
        type: 'body',
        metatype: WordPressProductDto,
      },
    );
    expect(result.priceCurrencyCode).toBeUndefined();
  });

  it('accepts variable product payload with variations', async () => {
    const result = await pipe.transform(
      {
        ...baseProduct,
        isVariable: true,
        variationAttributes: [{ name: 'سایز', options: ['S', 'M'] }],
        variations: [
          {
            externalVariationId: '10',
            price: 1000,
            regularPrice: 1200,
            salePrice: 1000,
            stockQuantity: 2,
            inStock: true,
            attributes: [{ name: 'سایز', value: 'S' }],
          },
        ],
      },
      {
        type: 'body',
        metatype: WordPressProductDto,
      },
    );
    expect(result.isVariable).toBe(true);
    expect(result.variations).toHaveLength(1);
    expect(result.variations[0].price).toBe(1000);
    expect(result.variationAttributes[0].name).toBe('سایز');
  });
});
