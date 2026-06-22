import { Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../../infrastructure/prisma/prisma.service';
import {
  AdminCreateLandingPageDto,
  AdminUpdateLandingPageDto,
  LandingSectionPayloadDto,
} from '../dto/admin-landing-page.dto';
import { coerceLandingSections } from '../../../common/landing/landing-sections.util';
import {
  loadSellerLandingSeedSections,
  sellerLandingSeedDescription,
  sellerLandingSeedMeta,
  sellerLandingSeedTitle,
  SELLER_LANDING_SLUG,
  SELLER_LANDING_SECTION_COUNT,
} from '../../../common/landing/seller-landing.seed';
import {
  INVITE_LANDING_SECTION_COUNT,
  INVITE_LANDING_SLUG,
  inviteLandingSeedDescription,
  inviteLandingSeedMeta,
  inviteLandingSeedTitle,
  loadInviteLandingSeedSections,
} from '../../../common/landing/invite-landing.seed';

export type LandingPageRecord = {
  id: string;
  slug: string;
  title: string;
  description: string | null;
  isPublished: boolean;
  sections: LandingSectionPayloadDto[];
  meta: Record<string, unknown> | null;
  createdAt: string;
  updatedAt: string;
};

@Injectable()
export class AdminLandingPagesService {
  constructor(private readonly prisma: PrismaService) {}

  async list(): Promise<LandingPageRecord[]> {
    const rows = await this.prisma.landingPage.findMany({
      orderBy: { updatedAt: 'desc' },
    });
    return rows.map((r) => this.toRecord(r));
  }

  async getById(id: string): Promise<LandingPageRecord> {
    const row = await this.prisma.landingPage.findUnique({ where: { id } });
    if (!row) throw new NotFoundException('صفحه لندینگ یافت نشد');
    return this.toRecord(row);
  }

  async create(
    dto: AdminCreateLandingPageDto,
    createdById?: string,
  ): Promise<LandingPageRecord> {
    const slugBase = dto.slug?.trim() || this.slugify(dto.title);
    const slug = await this.makeUniqueSlug(slugBase);
    const created = await this.prisma.landingPage.create({
      data: {
        slug,
        title: dto.title.trim(),
        description: dto.description?.trim() || null,
        isPublished: dto.isPublished ?? false,
        sections: coerceLandingSections(dto.sections ?? []) as Prisma.InputJsonValue,
        meta: (dto.meta ?? null) as Prisma.InputJsonValue,
        createdById: createdById ?? null,
      },
    });
    return this.toRecord(created);
  }

  async update(
    id: string,
    dto: AdminUpdateLandingPageDto,
  ): Promise<LandingPageRecord> {
    const current = await this.prisma.landingPage.findUnique({ where: { id } });
    if (!current) throw new NotFoundException('صفحه لندینگ یافت نشد');

    const title = dto.title?.trim() || current.title;
    const description =
      dto.description === undefined
        ? current.description
        : dto.description?.trim() || null;
    const isPublished =
      dto.isPublished === undefined ? current.isPublished : dto.isPublished;
    const sections =
      dto.sections === undefined
        ? current.sections
        : (coerceLandingSections(dto.sections) as Prisma.InputJsonValue);
    const meta =
      dto.meta === undefined
        ? current.meta
        : (dto.meta as Prisma.InputJsonValue);

    let slug = current.slug;
    if (dto.slug?.trim()) {
      slug = await this.makeUniqueSlug(this.slugify(dto.slug.trim()), id);
    } else if (dto.title && dto.title.trim() !== current.title) {
      slug = await this.makeUniqueSlug(this.slugify(title), id);
    }

    const updated = await this.prisma.landingPage.update({
      where: { id },
      data: { title, description, isPublished, sections, meta, slug },
    });
    return this.toRecord(updated);
  }

  async remove(id: string): Promise<{ ok: true }> {
    const existing = await this.prisma.landingPage.findUnique({ where: { id } });
    if (!existing) throw new NotFoundException('صفحه لندینگ یافت نشد');
    await this.prisma.landingPage.delete({ where: { id } });
    return { ok: true };
  }

  async duplicate(id: string, createdById?: string): Promise<LandingPageRecord> {
    const source = await this.getById(id);
    return this.create(
      {
        title: `${source.title} (کپی)`,
        description: source.description ?? undefined,
        isPublished: false,
        sections: source.sections,
        meta: source.meta ?? undefined,
      },
      createdById,
    );
  }

  /**
   * Creates or upgrades `/seller` landing from seed JSON.
   * Used by admin endpoint, CLI script, and dev bootstrap.
   */
  async seedSellerLanding(force = false): Promise<{
    action: 'created' | 'updated' | 'skipped';
    slug: string;
    sectionCount: number;
    isPublished: boolean;
  }> {
    const sections = loadSellerLandingSeedSections();
    const meta = sellerLandingSeedMeta();
    const existing = await this.prisma.landingPage.findUnique({
      where: { slug: SELLER_LANDING_SLUG },
    });

    if (!existing) {
      const created = await this.prisma.landingPage.create({
        data: {
          slug: SELLER_LANDING_SLUG,
          title: sellerLandingSeedTitle(),
          description: sellerLandingSeedDescription(),
          isPublished: true,
          sections: sections as Prisma.InputJsonValue,
          meta: meta as Prisma.InputJsonValue,
        },
      });
      return {
        action: 'created',
        slug: created.slug,
        sectionCount: sections.length,
        isPublished: created.isPublished,
      };
    }

    const currentCount = coerceLandingSections(existing.sections).length;
    if (!force && currentCount >= SELLER_LANDING_SECTION_COUNT) {
      return {
        action: 'skipped',
        slug: existing.slug,
        sectionCount: currentCount,
        isPublished: existing.isPublished,
      };
    }

    const updated = await this.prisma.landingPage.update({
      where: { id: existing.id },
      data: {
        title: sellerLandingSeedTitle(),
        description: sellerLandingSeedDescription(),
        sections: sections as Prisma.InputJsonValue,
        meta: meta as Prisma.InputJsonValue,
        isPublished: existing.isPublished || true,
      },
    });
    return {
      action: 'updated',
      slug: updated.slug,
      sectionCount: sections.length,
      isPublished: updated.isPublished,
    };
  }

  /**
   * Creates or upgrades `/invite` promo landing from seed JSON.
   */
  async seedInviteLanding(force = false): Promise<{
    action: 'created' | 'updated' | 'skipped';
    slug: string;
    sectionCount: number;
    isPublished: boolean;
  }> {
    const sections = loadInviteLandingSeedSections();
    const meta = inviteLandingSeedMeta();
    const existing = await this.prisma.landingPage.findUnique({
      where: { slug: INVITE_LANDING_SLUG },
    });

    if (!existing) {
      const created = await this.prisma.landingPage.create({
        data: {
          slug: INVITE_LANDING_SLUG,
          title: inviteLandingSeedTitle(),
          description: inviteLandingSeedDescription(),
          isPublished: true,
          sections: sections as Prisma.InputJsonValue,
          meta: meta as Prisma.InputJsonValue,
        },
      });
      return {
        action: 'created',
        slug: created.slug,
        sectionCount: sections.length,
        isPublished: created.isPublished,
      };
    }

    const currentCount = coerceLandingSections(existing.sections).length;
    if (!force && currentCount >= INVITE_LANDING_SECTION_COUNT) {
      return {
        action: 'skipped',
        slug: existing.slug,
        sectionCount: currentCount,
        isPublished: existing.isPublished,
      };
    }

    const updated = await this.prisma.landingPage.update({
      where: { id: existing.id },
      data: {
        title: inviteLandingSeedTitle(),
        description: inviteLandingSeedDescription(),
        sections: sections as Prisma.InputJsonValue,
        meta: meta as Prisma.InputJsonValue,
        isPublished: existing.isPublished || true,
      },
    });
    return {
      action: 'updated',
      slug: updated.slug,
      sectionCount: sections.length,
      isPublished: updated.isPublished,
    };
  }

  private toRecord(row: {
    id: string;
    slug: string;
    title: string;
    description: string | null;
    isPublished: boolean;
    sections: unknown;
    meta: unknown;
    createdAt: Date;
    updatedAt: Date;
  }): LandingPageRecord {
    return {
      id: row.id,
      slug: row.slug,
      title: row.title,
      description: row.description,
      isPublished: row.isPublished,
      sections: coerceLandingSections(row.sections) as LandingSectionPayloadDto[],
      meta:
        row.meta && typeof row.meta === 'object' && !Array.isArray(row.meta)
          ? (row.meta as Record<string, unknown>)
          : null,
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
    };
  }

  private slugify(input: string): string {
    const base = input
      .toLowerCase()
      .replace(/[^a-z0-9\u0600-\u06FF\s-]/g, '')
      .trim()
      .replace(/\s+/g, '-')
      .replace(/-+/g, '-');
    return base || `page-${Date.now()}`;
  }

  private async makeUniqueSlug(
    base: string,
    excludeId?: string,
  ): Promise<string> {
    const exists = async (slug: string): Promise<boolean> => {
      const row = await this.prisma.landingPage.findUnique({
        where: { slug },
        select: { id: true },
      });
      return !!row && row.id !== excludeId;
    };
    if (!(await exists(base))) return base;
    let i = 2;
    let candidate = `${base}-${i}`;
    while (await exists(candidate)) {
      i += 1;
      candidate = `${base}-${i}`;
    }
    return candidate;
  }
}
