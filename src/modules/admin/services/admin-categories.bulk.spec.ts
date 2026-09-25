import { BadRequestException } from '@nestjs/common';
import { AdminCategoriesService } from './admin-categories.service';

describe('AdminCategoriesService bulk helpers', () => {
  const prismaMock: any = {
    category: {
      findUnique: jest.fn(),
      findMany: jest.fn(),
      update: jest.fn(),
      updateMany: jest.fn(),
    },
  };
  const listingDeleteMock = {};
  const categoryTreeMock = { invalidate: jest.fn().mockResolvedValue(undefined) };
  const cacheMock = {
    delete: jest.fn().mockResolvedValue(undefined),
    deleteByPrefix: jest.fn().mockResolvedValue(undefined),
  };

  let service: AdminCategoriesService;

  beforeEach(() => {
    jest.clearAllMocks();
    service = new AdminCategoriesService(
      prismaMock as any,
      listingDeleteMock as any,
      categoryTreeMock as any,
      cacheMock as any,
    );
  });

  it('bulkSetActive deactivates full subtrees of selected roots', async () => {
    prismaMock.category.findMany.mockResolvedValue([
      { id: 'root', parentId: null },
      { id: 'child', parentId: 'root' },
      { id: 'grand', parentId: 'child' },
      { id: 'other', parentId: null },
    ]);
    prismaMock.category.updateMany.mockResolvedValue({ count: 3 });

    const result = await service.bulkSetActive({
      ids: ['root'],
      isActive: false,
    });

    expect(result.affected).toBe(3);
    expect(prismaMock.category.updateMany).toHaveBeenCalledWith({
      where: { id: { in: expect.arrayContaining(['root', 'child', 'grand']) } },
      data: { isActive: false },
    });
  });

  it('bulkSetActive activates parent before child in same batch', async () => {
    prismaMock.category.findMany.mockResolvedValue([
      { id: 'root', parentId: null, isActive: false, title: 'Root' },
      { id: 'child', parentId: 'root', isActive: false, title: 'Child' },
    ]);
    prismaMock.category.updateMany.mockResolvedValue({ count: 2 });

    const result = await service.bulkSetActive({
      ids: ['child', 'root'],
      isActive: true,
    });

    expect(result.affected).toBe(2);
    expect(prismaMock.category.updateMany).toHaveBeenCalledWith({
      where: { id: { in: expect.arrayContaining(['root', 'child']) } },
      data: { isActive: true },
    });
  });

  it('bulkSetActive rejects children when parent stays inactive', async () => {
    prismaMock.category.findMany.mockResolvedValue([
      { id: 'root', parentId: null, isActive: false, title: 'Root' },
      { id: 'child', parentId: 'root', isActive: false, title: 'Child' },
    ]);

    await expect(
      service.bulkSetActive({ ids: ['child'], isActive: true }),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(prismaMock.category.updateMany).not.toHaveBeenCalled();
  });

  it('bulkUpdateFees applies fee fields to root and descendants', async () => {
    prismaMock.category.findUnique.mockResolvedValue({ id: 'root' });
    prismaMock.category.findMany.mockResolvedValue([
      { id: 'root', parentId: null },
      { id: 'child', parentId: 'root' },
    ]);
    prismaMock.category.updateMany.mockResolvedValue({ count: 2 });

    const result = await service.bulkUpdateFees({
      rootId: 'root',
      includeDescendants: true,
      feePercentageDirectNew: 3.5,
      feePercentageDirectUsed: 4,
    });

    expect(result.affected).toBe(2);
    expect(prismaMock.category.updateMany).toHaveBeenCalledWith({
      where: { id: { in: expect.arrayContaining(['root', 'child']) } },
      data: expect.objectContaining({
        feePercentageDirectNew: 3.5,
        feePercentageDirectUsed: 4,
        feePercentageDirect: 3.5,
      }),
    });
  });

  it('setActive with includeDescendants activates whole subtree', async () => {
    prismaMock.category.findUnique
      .mockResolvedValueOnce({ id: 'root', parentId: null })
      .mockResolvedValueOnce(null);
    prismaMock.category.findMany.mockResolvedValue([
      { id: 'root', parentId: null },
      { id: 'child', parentId: 'root' },
    ]);
    prismaMock.category.updateMany.mockResolvedValue({ count: 2 });

    const result = await service.setActive('root', {
      isActive: true,
      includeDescendants: true,
    });

    expect(result.affected).toBe(2);
  });
});
