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

  it('drops the discount when salePrice exceeds regularPrice instead of blocking the sync', async () => {
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
    expect(syncInput.compareAtPrice).toBeNull();
    expect(syncInput.salePrice).toBeNull();
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
