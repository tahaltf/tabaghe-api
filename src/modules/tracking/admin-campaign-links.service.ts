import {
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import {
  CreateCampaignLinkDto,
  UpdateCampaignLinkDto,
} from './dto/campaign-link.dto';
import { TrackingService } from './tracking.service';

@Injectable()
export class AdminCampaignLinksService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly tracking: TrackingService,
  ) {}

  list() {
    return this.prisma.campaignLink.findMany({
      orderBy: [{ createdAt: 'desc' }],
      include: {
        _count: { select: { clickLogs: true } },
        createdBy: {
          select: { id: true, firstName: true, lastName: true, phone: true },
        },
      },
    });
  }

  async get(id: string) {
    const row = await this.prisma.campaignLink.findUnique({
      where: { id },
      include: {
        _count: { select: { clickLogs: true } },
        createdBy: {
          select: { id: true, firstName: true, lastName: true, phone: true },
        },
      },
    });
    if (!row) {
      throw new NotFoundException('لینک کمپین یافت نشد');
    }
    return row;
  }

  async create(dto: CreateCampaignLinkDto, createdById?: string) {
    await this.tracking.assertSlugAvailable(dto.slug);
    return this.prisma.campaignLink.create({
      data: {
        name: dto.name.trim(),
        slug: dto.slug.trim().toLowerCase(),
        targetUrl: dto.targetUrl.trim(),
        description: dto.description?.trim() || null,
        isActive: dto.isActive ?? true,
        splitGroup: dto.splitGroup?.trim() || null,
        splitWeight: dto.splitWeight ?? 100,
        createdById: createdById ?? null,
      },
      include: { _count: { select: { clickLogs: true } } },
    });
  }

  async update(id: string, dto: UpdateCampaignLinkDto) {
    await this.get(id);
    if (dto.slug) {
      await this.tracking.assertSlugAvailable(dto.slug.trim().toLowerCase(), id);
    }
    return this.prisma.campaignLink.update({
      where: { id },
      data: {
        ...(dto.name !== undefined ? { name: dto.name.trim() } : {}),
        ...(dto.slug !== undefined
          ? { slug: dto.slug.trim().toLowerCase() }
          : {}),
        ...(dto.targetUrl !== undefined
          ? { targetUrl: dto.targetUrl.trim() }
          : {}),
        ...(dto.description !== undefined
          ? { description: dto.description?.trim() || null }
          : {}),
        ...(dto.isActive !== undefined ? { isActive: dto.isActive } : {}),
        ...(dto.splitGroup !== undefined
          ? { splitGroup: dto.splitGroup?.trim() || null }
          : {}),
        ...(dto.splitWeight !== undefined ? { splitWeight: dto.splitWeight } : {}),
      },
      include: { _count: { select: { clickLogs: true } } },
    });
  }

  async remove(id: string) {
    await this.get(id);
    await this.prisma.campaignLink.delete({ where: { id } });
    return { ok: true };
  }
}
