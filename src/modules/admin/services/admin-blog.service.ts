import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../../infrastructure/prisma/prisma.service';
import {
  AdminCreateBlogPostDto,
  AdminUpdateBlogPostDto,
} from '../dto/admin-blog.dto';

type BlogPost = {
  id: string;
  slug: string;
  title: string;
  description: string;
  image: string | null;
  outline: string | null;
  note: string | null;
  createdAt: string;
  updatedAt: string;
};

@Injectable()
export class AdminBlogService {
  constructor(private readonly prisma: PrismaService) {}

  async list(): Promise<BlogPost[]> {
    const rows = await this.prisma.blogPost.findMany({
      orderBy: { createdAt: 'desc' },
    });
    return rows.map((r) => ({
      id: r.id,
      slug: r.slug,
      title: r.title,
      description: r.description,
      image: r.image ?? null,
      outline: r.outline ?? null,
      note: r.note ?? null,
      createdAt: r.createdAt.toISOString(),
      updatedAt: r.updatedAt.toISOString(),
    }));
  }

  async create(dto: AdminCreateBlogPostDto): Promise<BlogPost> {
    const slugBase = this.slugify(dto.title);
    const slug = await this.makeUniqueSlug(slugBase);
    const created = await this.prisma.blogPost.create({
      data: {
        slug,
        title: dto.title.trim(),
        description: dto.description.trim(),
        image: dto.image?.trim() || null,
        outline: dto.outline?.trim() || null,
        note: dto.note?.trim() || null,
      },
    });
    return {
      id: created.id,
      slug,
      title: created.title,
      description: created.description,
      image: created.image ?? null,
      outline: created.outline ?? null,
      note: created.note ?? null,
      createdAt: created.createdAt.toISOString(),
      updatedAt: created.updatedAt.toISOString(),
    };
  }

  async update(id: string, dto: AdminUpdateBlogPostDto): Promise<BlogPost> {
    const current = await this.prisma.blogPost.findUnique({ where: { id } });
    if (!current) throw new NotFoundException('بلاگ یافت نشد');
    const title = dto.title?.trim() || current.title;
    const description = dto.description?.trim() || current.description;
    const image =
      dto.image === undefined ? current.image : dto.image?.trim() || null;
    const outline =
      dto.outline === undefined ? current.outline : dto.outline?.trim() || null;
    const note =
      dto.note === undefined ? current.note : dto.note?.trim() || null;
    const slug =
      dto.title && dto.title.trim() !== current.title
        ? await this.makeUniqueSlug(this.slugify(title), id)
        : current.slug;
    const updated = await this.prisma.blogPost.update({
      where: { id },
      data: { title, description, image, outline, note, slug },
    });
    return {
      id: updated.id,
      slug: updated.slug,
      title: updated.title,
      description: updated.description,
      image: updated.image ?? null,
      outline: updated.outline ?? null,
      note: updated.note ?? null,
      createdAt: updated.createdAt.toISOString(),
      updatedAt: updated.updatedAt.toISOString(),
    };
  }

  async remove(id: string): Promise<{ ok: true }> {
    const existing = await this.prisma.blogPost.findUnique({ where: { id } });
    if (!existing) {
      throw new NotFoundException('بلاگ یافت نشد');
    }
    await this.prisma.blogPost.delete({ where: { id } });
    return { ok: true };
  }

  private slugify(input: string): string {
    const base = input
      .toLowerCase()
      .replace(/[^a-z0-9\u0600-\u06FF\s-]/g, '')
      .trim()
      .replace(/\s+/g, '-')
      .replace(/-+/g, '-');
    return base || `post-${Date.now()}`;
  }

  private async makeUniqueSlug(
    base: string,
    excludeId?: string,
  ): Promise<string> {
    const exists = async (slug: string): Promise<boolean> => {
      const row = await this.prisma.blogPost.findUnique({
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
