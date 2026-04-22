import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { LocationType, Prisma } from '@prisma/client';
import { PrismaService } from '../../../infrastructure/prisma/prisma.service';
import {
  CreateLocationDto,
  UpdateLocationDto,
} from '../dto/admin-location.dto';

const LOCATION_SELECT = {
  id: true,
  name: true,
  type: true,
  parentId: true,
  createdAt: true,
  parent: { select: { id: true, name: true } },
  _count: { select: { children: true, provinceListings: true, cityListings: true } },
} satisfies Prisma.LocationSelect;

export type AdminLocationItem = Prisma.LocationGetPayload<{ select: typeof LOCATION_SELECT }>;

@Injectable()
export class AdminLocationsService {
  constructor(private readonly prisma: PrismaService) {}

  async list(type?: LocationType, search?: string): Promise<AdminLocationItem[]> {
    const where: Prisma.LocationWhereInput = {};
    if (type) where.type = type;
    if (search) {
      const s = search.trim();
      where.name = { contains: s, mode: 'insensitive' };
    }
    return this.prisma.location.findMany({
      where,
      select: LOCATION_SELECT,
      orderBy: [{ type: 'asc' }, { name: 'asc' }],
    });
  }

  async create(dto: CreateLocationDto): Promise<AdminLocationItem> {
    if (dto.type === LocationType.CITY && !dto.parentId) {
      throw new BadRequestException('برای شهر، انتخاب استان الزامی است');
    }
    if (dto.parentId) {
      const parent = await this.prisma.location.findUnique({ where: { id: dto.parentId } });
      if (!parent) throw new BadRequestException('والد یافت نشد');
      if (dto.type === LocationType.CITY && parent.type !== LocationType.PROVINCE) {
        throw new BadRequestException('والد شهر باید از نوع استان باشد');
      }
    }
    return this.prisma.location.create({
      data: {
        name: dto.name.trim(),
        type: dto.type,
        parentId: dto.parentId ?? null,
      },
      select: LOCATION_SELECT,
    });
  }

  async update(id: string, dto: UpdateLocationDto): Promise<AdminLocationItem> {
    const loc = await this.prisma.location.findUnique({ where: { id } });
    if (!loc) throw new NotFoundException('موقعیت یافت نشد');
    if (dto.parentId !== undefined && dto.parentId && dto.parentId === id) {
      throw new BadRequestException('والد نمی‌تواند خودش باشد');
    }
    return this.prisma.location.update({
      where: { id },
      data: {
        name: dto.name?.trim() ?? undefined,
        type: dto.type ?? undefined,
        parentId: dto.parentId === undefined ? undefined : dto.parentId,
      },
      select: LOCATION_SELECT,
    });
  }

  async remove(id: string): Promise<{ id: string }> {
    const loc = await this.prisma.location.findUnique({
      where: { id },
      select: {
        _count: {
          select: { children: true, provinceListings: true, cityListings: true },
        },
      },
    });
    if (!loc) throw new NotFoundException('موقعیت یافت نشد');
    const { children, provinceListings, cityListings } = loc._count;
    if (children > 0) {
      throw new ConflictException('ابتدا شهرهای زیرمجموعه را حذف کنید');
    }
    if (provinceListings > 0 || cityListings > 0) {
      throw new ConflictException('این موقعیت در آگهی‌ها استفاده شده و قابل حذف نیست');
    }
    await this.prisma.location.delete({ where: { id } });
    return { id };
  }
}
