import { PrismaClient, Prisma } from '@prisma/client';
import {
  loadSellerLandingSeedSections,
  sellerLandingSeedDescription,
  sellerLandingSeedMeta,
  sellerLandingSeedTitle,
  SELLER_LANDING_SLUG,
  SELLER_LANDING_SECTION_COUNT,
} from '../src/common/landing/seller-landing.seed';
import { coerceLandingSections } from '../src/common/landing/landing-sections.util';

async function main() {
  const force = process.argv.includes('--force');
  const prisma = new PrismaClient();
  try {
    const sections = loadSellerLandingSeedSections();
    const meta = sellerLandingSeedMeta();
    const existing = await prisma.landingPage.findUnique({
      where: { slug: SELLER_LANDING_SLUG },
    });

    if (!existing) {
      const created = await prisma.landingPage.create({
        data: {
          slug: SELLER_LANDING_SLUG,
          title: sellerLandingSeedTitle(),
          description: sellerLandingSeedDescription(),
          isPublished: true,
          sections: sections as Prisma.InputJsonValue,
          meta: meta as Prisma.InputJsonValue,
        },
      });
      console.log(`Created seller landing (${created.id}) with ${sections.length} sections.`);
      return;
    }

    const currentCount = coerceLandingSections(existing.sections).length;
    if (!force && currentCount >= SELLER_LANDING_SECTION_COUNT) {
      console.log(`Skipped — seller landing already has ${currentCount} sections. Use --force to overwrite.`);
      return;
    }

    await prisma.landingPage.update({
      where: { id: existing.id },
      data: {
        title: sellerLandingSeedTitle(),
        description: sellerLandingSeedDescription(),
        sections: sections as Prisma.InputJsonValue,
        meta: meta as Prisma.InputJsonValue,
        isPublished: true,
      },
    });
    console.log(`Updated seller landing with ${sections.length} sections.`);
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
