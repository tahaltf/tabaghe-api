import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function testSlug(slug) {
  console.log(`\n=== Testing slug: ${slug} ===`);
  try {
    const category = await prisma.category.findFirst({
      where: { slug },
      select: {
        id: true,
        title: true,
        slug: true,
        icon: true,
        parentId: true,
        isActive: true,
        parent: { select: { id: true, title: true, slug: true, isActive: true } },
        children: {
          orderBy: { title: 'asc' },
          select: { id: true, title: true, slug: true, icon: true, isActive: true },
        },
      },
    });
    if (!category) {
      console.log('Category not found');
      return;
    }
    console.log('Category:', category.title, category.id);

    const categoryIds = [category.id];
    const queue = [category.id];
    const childrenRows = await prisma.category.findMany({ select: { id: true, parentId: true } });
    const byParent = new Map();
    for (const r of childrenRows) {
      const list = byParent.get(r.parentId) ?? [];
      list.push(r.id);
      byParent.set(r.parentId, list);
    }
    while (queue.length) {
      const cur = queue.shift();
      for (const childId of byParent.get(cur) ?? []) {
        if (!categoryIds.includes(childId)) {
          categoryIds.push(childId);
          queue.push(childId);
        }
      }
    }
    console.log('Descendant count:', categoryIds.length);

    const listingWhere = {
      status: 'APPROVED',
      deletedAt: null,
      categoryId: { in: categoryIds },
    };

    const listingCount = await prisma.listing.count({ where: listingWhere });
    console.log('Listing count:', listingCount);

    const recentListings = await prisma.listing.findMany({
      where: listingWhere,
      select: {
        id: true,
        title: true,
        type: true,
        thumbnail: true,
        createdAt: true,
        category: { select: { id: true, title: true, slug: true } },
        city: { select: { id: true, name: true, slug: true } },
        direct: { select: { price: true } },
        auction: {
          select: {
            basePrice: true,
            highestBidAmount: true,
            endDatetime: true,
            status: true,
          },
        },
      },
      orderBy: { createdAt: 'desc' },
      take: 24,
    });
    console.log('Recent listings:', recentListings.length);

    const grouped = await prisma.listing.groupBy({
      by: ['cityId'],
      where: {
        status: 'APPROVED',
        deletedAt: null,
        categoryId: { in: categoryIds },
        cityId: { not: null },
      },
      _count: { _all: true },
    });
    console.log('Top locations grouped:', grouped.length);
    console.log('SUCCESS');
  } catch (err) {
    console.error('FAILED:', err.message);
    console.error(err.stack);
  }
}

try {
  await testSlug('mobile-tablet');
  await testSlug('vehicles');
} finally {
  await prisma.$disconnect();
}
