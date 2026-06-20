import { Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../../infrastructure/prisma/prisma.service';
import {
  AdminCreateLandingPageDto,
  AdminUpdateLandingPageDto,
} from '../dto/admin-landing-page.dto';
import { coerceLandingSections } from '../../../common/landing/landing-sections.util';

export type LandingPageRecord = {
  id: string;
  slug: string;
  title: string;
  description: string | null;
  isPublished: boolean;
  sections: unknown[];
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
      sections: coerceLandingSections(row.sections),
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
