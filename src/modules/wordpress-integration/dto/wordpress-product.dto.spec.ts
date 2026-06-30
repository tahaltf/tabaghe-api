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
});
