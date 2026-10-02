import { PrismaClient, Prisma } from '@prisma/client';
import {
  loadSellerLandingSeedSections,
  sellerLandingSeedDescription,
  sellerLandingSeedMeta,
  sellerLandingSeedTitle,
  SELLER_LANDING_SLUG,
  SELLER_LANDING_SECTION_COUNT,
} from '../src/common/landing/seller-landing.seed';
import {
  BUYER_LANDING_SECTION_COUNT,
  BUYER_LANDING_SLUG,
  buyerLandingSeedDescription,
  buyerLandingSeedMeta,
  buyerLandingSeedTitle,
  loadBuyerLandingSeedSections,
} from '../src/common/landing/buyer-landing.seed';
import { coerceLandingSections } from '../src/common/landing/landing-sections.util';

async function upsertLanding(
  prisma: PrismaClient,
  force: boolean,
  input: {
    slug: string;
    title: string;
    description: string;
    minSections: number;
    sections: unknown[];
    meta: Record<string, unknown>;
  },
) {
  const existing = await prisma.landingPage.findUnique({
    where: { slug: input.slug },
  });

  if (!existing) {
    const created = await prisma.landingPage.create({
      data: {
        slug: input.slug,
        title: input.title,
        description: input.description,
        isPublished: true,
        sections: input.sections as Prisma.InputJsonValue,
        meta: input.meta as Prisma.InputJsonValue,
      },
    });
    console.log(`Created ${input.slug} landing (${created.id}) with ${input.sections.length} sections.`);
    return;
  }

  const currentCount = coerceLandingSections(existing.sections).length;
  if (!force && currentCount >= input.minSections) {
    console.log(
      `Skipped ${input.slug} — already has ${currentCount} sections. Use --force to overwrite.`,
    );
    return;
  }

  await prisma.landingPage.update({
    where: { id: existing.id },
    data: {
      title: input.title,
      description: input.description,
      sections: input.sections as Prisma.InputJsonValue,
      meta: input.meta as Prisma.InputJsonValue,
      isPublished: true,
    },
  });
  console.log(`Updated ${input.slug} landing with ${input.sections.length} sections.`);
}

async function main() {
  const force = process.argv.includes('--force');
  const prisma = new PrismaClient();
  try {
    await upsertLanding(prisma, force, {
      slug: SELLER_LANDING_SLUG,
      title: sellerLandingSeedTitle(),
      description: sellerLandingSeedDescription(),
      minSections: SELLER_LANDING_SECTION_COUNT,
      sections: loadSellerLandingSeedSections(),
      meta: sellerLandingSeedMeta(),
    });
    await upsertLanding(prisma, force, {
      slug: BUYER_LANDING_SLUG,
      title: buyerLandingSeedTitle(),
      description: buyerLandingSeedDescription(),
      minSections: BUYER_LANDING_SECTION_COUNT,
      sections: loadBuyerLandingSeedSections(),
      meta: buyerLandingSeedMeta(),
    });
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
