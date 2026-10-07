import { Test, TestingModule } from '@nestjs/testing';
import { WordPressProductIngestService } from './product-ingest.service';
import { PrismaService } from '../../../infrastructure/prisma/prisma.service';
import { RemoteImageService } from './remote-image.service';
import { WordPressConnectionService } from './connection.service';
import { ListingCommandService } from '../../listing/services/listing-command.service';
import { WordPressCategoriesService } from './wordpress-categories.service';
import { ListingNotificationBatchService } from '../../../common/notification/listing-notification-batch.service';
import { WordPressProductDto } from '../dto/wordpress-product.dto';

describe('WordPressProductIngestService pricing', () => {
  let service: WordPressProductIngestService;

  const remoteImagesMock = {
    downloadMany: jest.fn().mockResolvedValue([]),
  };

  beforeEach(async () => {
    jest.clearAllMocks();
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        WordPressProductIngestService,
        { provide: PrismaService, useValue: {} },
        { provide: RemoteImageService, useValue: remoteImagesMock },
        { provide: WordPressConnectionService, useValue: {} },
        { provide: ListingCommandService, useValue: {} },
        { provide: WordPressCategoriesService, useValue: {} },
        {
          provide: ListingNotificationBatchService,
          useValue: { flushAdminNewListingAlerts: jest.fn() },
        },
      ],
    }).compile();
    service = module.get(WordPressProductIngestService);
  });

  it('uses regularPrice (not effective price) when validating on-sale WooCommerce products', async () => {
    const dto = {
      externalProductId: '123',
      siteUrl: 'https://example.com/',
      title: 'On sale product',
      description: 'Desc',
      price: 80_000,
      regularPrice: 100_000,
      salePrice: 80_000,
      images: [{ url: 'https://example.com/img.jpg' }],
      attributes: [],
    } as WordPressProductDto;

    const syncInput = await (service as any).buildSyncInput(
      'user-1',
      dto,
      { categoryId: 'cat-1', provinceId: 'prov-1', cityId: 'city-1' },
      'cat-1',
      1,
    );

    expect(syncInput.price).toBe(100_000);
    expect(syncInput.compareAtPrice).toBe(100_000);
    expect(syncInput.salePrice).toBe(80_000);
  });

  it('uses regularPrice as list price when payload price is the WooCommerce sale amount', async () => {
    const dto = {
      externalProductId: '123',
      siteUrl: 'https://example.com/',
      title: 'WC convention sale',
      description: 'Desc',
      price: 80_000,
      regularPrice: 100_000,
      salePrice: 80_000,
      images: [{ url: 'https://example.com/img.jpg' }],
      attributes: [],
    } as WordPressProductDto;

    const syncInput = await (service as any).buildSyncInput(
      'user-1',
      dto,
      { categoryId: 'cat-1', provinceId: 'prov-1', cityId: 'city-1' },
      'cat-1',
      1,
    );

    expect(syncInput.price).toBe(100_000);
    expect(syncInput.compareAtPrice).toBe(100_000);
    expect(syncInput.salePrice).toBe(80_000);
  });

  it('infers sale from effective price when salePrice is omitted but below regularPrice', async () => {
    const dto = {
      externalProductId: '123',
      siteUrl: 'https://example.com/',
      title: 'Implicit sale product',
      description: 'Desc',
      price: 80_000,
      regularPrice: 100_000,
      images: [{ url: 'https://example.com/img.jpg' }],
      attributes: [],
    } as WordPressProductDto;

    const syncInput = await (service as any).buildSyncInput(
      'user-1',
      dto,
      { categoryId: 'cat-1', provinceId: 'prov-1', cityId: 'city-1' },
      'cat-1',
      1,
    );

    expect(syncInput.price).toBe(100_000);
    expect(syncInput.compareAtPrice).toBe(100_000);
    expect(syncInput.salePrice).toBe(80_000);
  });

  it('drops the discount (instead of failing) when regularPrice is missing and effective price equals salePrice', async () => {
    const dto = {
      externalProductId: '123',
      siteUrl: 'https://example.com/',
      title: 'On sale product',
      description: 'Desc',
      price: 80_000,
      salePrice: 80_000,
      images: [{ url: 'https://example.com/img.jpg' }],
      attributes: [],
    } as WordPressProductDto;

    const syncInput = await (service as any).buildSyncInput(
      'user-1',
      dto,
      { categoryId: 'cat-1', provinceId: 'prov-1', cityId: 'city-1' },
      'cat-1',
      1,
    );

    expect(syncInput.price).toBe(80_000);
    expect(syncInput.compareAtPrice).toBeNull();
    expect(syncInput.salePrice).toBeNull();
  });

  it('recovers sale from effective price when salePrice is invalid but below regularPrice', async () => {
    const dto = {
      externalProductId: '123',
      siteUrl: 'https://example.com/',
      title: 'Out of stock product',
      description: 'Desc',
      price: 90_000,
      regularPrice: 100_000,
      salePrice: 120_000,
      images: [{ url: 'https://example.com/img.jpg' }],
      attributes: [],
    } as WordPressProductDto;

    const syncInput = await (service as any).buildSyncInput(
      'user-1',
      dto,
      { categoryId: 'cat-1', provinceId: 'prov-1', cityId: 'city-1' },
      'cat-1',
      1,
    );

    expect(syncInput.price).toBe(100_000);
    expect(syncInput.compareAtPrice).toBe(100_000);
    expect(syncInput.salePrice).toBe(90_000);
  });

  it('passes priceCurrencyCode through sync input and create DTO', async () => {
    const dto = {
      externalProductId: '123',
      siteUrl: 'https://example.com/',
      title: 'USD product',
      description: 'Desc',
      price: 10,
      priceCurrencyCode: 'USD',
      images: [{ url: 'https://example.com/img.jpg' }],
      attributes: [],
    } as WordPressProductDto;

    const syncInput = await (service as any).buildSyncInput(
      'user-1',
      dto,
      { categoryId: 'cat-1', provinceId: 'prov-1', cityId: 'city-1' },
      'cat-1',
      1,
    );

    expect(syncInput.priceCurrencyCode).toBe('USD');

    const createDto = (service as any).toCreateListingDto(syncInput);
    expect(createDto.priceCurrencyCode).toBe('USD');
  });

  it('defaults priceCurrencyCode to null when omitted', async () => {
    const dto = {
      externalProductId: '123',
      siteUrl: 'https://example.com/',
      title: 'IRT product',
      description: 'Desc',
      price: 1000,
      images: [{ url: 'https://example.com/img.jpg' }],
      attributes: [],
    } as WordPressProductDto;

    const syncInput = await (service as any).buildSyncInput(
      'user-1',
      dto,
      { categoryId: 'cat-1', provinceId: 'prov-1', cityId: 'city-1' },
      'cat-1',
      1,
    );

    expect(syncInput.priceCurrencyCode).toBeNull();
  });

  it('maps variable products with per-variation sale prices and stock', async () => {
    remoteImagesMock.downloadMany
      .mockResolvedValueOnce(['gallery-1.jpg'])
      .mockResolvedValueOnce(['var-a.jpg'])
      .mockResolvedValueOnce([]);

    const dto = {
      externalProductId: '99',
      siteUrl: 'https://example.com/',
      title: 'Variable shirt',
      description: 'A variable product description long enough for sync.',
      price: 80_000,
      regularPrice: 100_000,
      salePrice: 80_000,
      images: [{ url: 'https://example.com/img.jpg' }],
      attributes: [
        {
          name: 'سایز',
          slug: 'pa_size',
          visible: true,
          variation: true,
          options: ['S', 'M'],
        },
      ],
      isVariable: true,
      variationAttributes: [{ name: 'سایز', options: ['S', 'M'] }],
      variations: [
        {
          externalVariationId: '1',
          price: 100_000,
          regularPrice: 100_000,
          salePrice: 80_000,
          stockQuantity: 3,
          inStock: true,
          imageUrl: 'https://example.com/var-a.jpg',
          attributes: [{ name: 'سایز', value: 'S' }],
        },
        {
          externalVariationId: '2',
          price: 120_000,
          regularPrice: 120_000,
          salePrice: null,
          stockQuantity: null,
          inStock: true,
          attributes: [{ name: 'سایز', value: 'M' }],
        },
      ],
    } as WordPressProductDto;

    const syncInput = await (service as any).buildSyncInput(
      'user-1',
      dto,
      { categoryId: 'cat-1', provinceId: 'prov-1', cityId: 'city-1' },
      'cat-1',
      5,
      1,
    );

    expect(syncInput.isVariable).toBe(true);
    expect(syncInput.variations).toHaveLength(2);
    expect(syncInput.variations[0]).toMatchObject({
      price: 100_000,
      compareAtPrice: 100_000,
      salePrice: 80_000,
      stockQuantity: 3,
      imageUrl: 'var-a.jpg',
      attributes: [{ name: 'سایز', value: 'S' }],
    });
    expect(syncInput.variations[1]).toMatchObject({
      price: 120_000,
      salePrice: null,
      stockQuantity: 1,
      attributes: [{ name: 'سایز', value: 'M' }],
    });
    expect(syncInput.stockQuantity).toBe(4);
    expect(syncInput.price).toBe(100_000);
    expect(syncInput.salePrice).toBe(80_000);

    const createDto = (service as any).toCreateListingDto(syncInput);
    expect(createDto.isVariable).toBe(true);
    expect(createDto.variations).toHaveLength(2);
    expect(createDto.variationAttributes).toEqual([
      { name: 'سایز', options: ['S', 'M'] },
    ]);
  });

  it('derives variable axes from variations when plugin omits isVariable/axes', async () => {
    remoteImagesMock.downloadMany.mockResolvedValueOnce(['gallery-1.jpg']);

    const dto = {
      externalProductId: '77',
      siteUrl: 'https://example.com/',
      title: 'Implicit variable',
      description: 'A variable product description long enough for sync.',
      price: 90_000,
      regularPrice: 90_000,
      images: [{ url: 'https://example.com/img.jpg' }],
      attributes: [
        {
          name: 'رنگ',
          slug: 'pa_color',
          visible: true,
          variation: true,
          options: ['قرمز', 'آبی'],
        },
      ],
      isVariable: false,
      variations: [
        {
          externalVariationId: '10',
          price: 90_000,
          regularPrice: 90_000,
          stockQuantity: 2,
          inStock: true,
          attributes: [{ name: 'رنگ', value: 'قرمز' }],
        },
        {
          externalVariationId: '11',
          price: 95_000,
          regularPrice: 95_000,
          stockQuantity: 1,
          inStock: true,
          attributes: [{ name: 'رنگ', value: 'آبی' }],
        },
      ],
    } as WordPressProductDto;

    const syncInput = await (service as any).buildSyncInput(
      'user-1',
      dto,
      { categoryId: 'cat-1', provinceId: 'prov-1', cityId: 'city-1' },
      'cat-1',
      1,
      1,
    );

    expect(syncInput.isVariable).toBe(true);
    expect(syncInput.variations).toHaveLength(2);
    expect(syncInput.variationAttributes).toEqual([
      { name: 'رنگ', options: ['قرمز', 'آبی'] },
    ]);
  });

  it('keeps 38M list and 28M sale when recovering WC-style discount payload', async () => {
    const dto = {
      externalProductId: '38-28',
      siteUrl: 'https://example.com/',
      title: 'Discounted phone',
      description: 'Desc',
      price: 28_000_000,
      regularPrice: 38_000_000,
      salePrice: null,
      images: [{ url: 'https://example.com/img.jpg' }],
      attributes: [],
    } as WordPressProductDto;

    const syncInput = await (service as any).buildSyncInput(
      'user-1',
      dto,
      { categoryId: 'cat-1', provinceId: 'prov-1', cityId: 'city-1' },
      'cat-1',
      1,
    );

    expect(syncInput.price).toBe(38_000_000);
    expect(syncInput.compareAtPrice).toBe(38_000_000);
    expect(syncInput.salePrice).toBe(28_000_000);
  });

  it('does not mark as variable when variations are empty', async () => {
    const dto = {
      externalProductId: '99',
      siteUrl: 'https://example.com/',
      title: 'Broken variable',
      description: 'Desc',
      price: 50_000,
      images: [{ url: 'https://example.com/img.jpg' }],
      attributes: [],
      isVariable: true,
      variationAttributes: [{ name: 'رنگ', options: ['قرمز'] }],
      variations: [],
    } as WordPressProductDto;

    const syncInput = await (service as any).buildSyncInput(
      'user-1',
      dto,
      { categoryId: 'cat-1', provinceId: 'prov-1', cityId: 'city-1' },
      'cat-1',
      1,
    );

    expect(syncInput.isVariable).toBe(false);
    expect(syncInput.variations).toBeUndefined();
  });
});

describe('WordPressProductIngestService availability', () => {
  let service: WordPressProductIngestService;

  const resolve = (
    dto: Partial<WordPressProductDto>,
    minStock = 1,
  ): { isPublished: boolean; siteStock: number } =>
    (service as any).resolveAvailability(dto as WordPressProductDto, minStock);

  beforeEach(async () => {
    jest.clearAllMocks();
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        WordPressProductIngestService,
        { provide: PrismaService, useValue: {} },
        {
          provide: RemoteImageService,
          useValue: { downloadMany: jest.fn().mockResolvedValue([]) },
        },
        { provide: WordPressConnectionService, useValue: {} },
        { provide: ListingCommandService, useValue: {} },
        { provide: WordPressCategoriesService, useValue: {} },
        {
          provide: ListingNotificationBatchService,
          useValue: { flushAdminNewListingAlerts: jest.fn() },
        },
      ],
    }).compile();
    service = module.get(WordPressProductIngestService);
  });

  it('marks stockQuantity 0 as published but siteStock 0', () => {
    expect(
      resolve({ status: 'publish', inStock: true, stockQuantity: 0 }),
    ).toEqual({ isPublished: true, siteStock: 0 });
  });

  it('applies minStock threshold so stock 1 becomes unavailable when min is 2', () => {
    expect(
      resolve({ status: 'publish', inStock: true, stockQuantity: 1 }, 2),
    ).toEqual({ isPublished: true, siteStock: 0 });
    expect(
      resolve({ status: 'publish', inStock: true, stockQuantity: 2 }, 2),
    ).toEqual({ isPublished: true, siteStock: 2 });
  });

  it('keeps unmanaged stock available when inStock is true', () => {
    expect(
      resolve({ status: 'publish', inStock: true, stockQuantity: null }),
    ).toEqual({ isPublished: true, siteStock: 1 });
  });

  it('marks draft as unpublished', () => {
    expect(
      resolve({ status: 'draft', inStock: true, stockQuantity: 5 }),
    ).toEqual({ isPublished: false, siteStock: 0 });
  });
});
