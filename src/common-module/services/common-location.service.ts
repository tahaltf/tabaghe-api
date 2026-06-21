import {
  BadRequestException,
  ConflictException,
  Injectable,
} from '@nestjs/common';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { TtlCacheService } from '../../infrastructure/cache/ttl-cache.service';
import { findLocationBySlug } from '../location-slug.util';


@Injectable()
export class CommonLocationService {
  private static readonly CACHE_TTL_SECONDS = 120;

  constructor(
    private readonly prisma: PrismaService,
    private readonly cache: TtlCacheService,
  ) {}

  async getProvinces() {
    return this.cache.getOrSet('common:provinces', CommonLocationService.CACHE_TTL_SECONDS, () =>
      this.prisma.location.findMany({
        where: { type: 'PROVINCE' },
        orderBy: { name: 'asc' },
        select: { id: true, name: true, slug: true },
      }),
    );
  }

  // دریافت شهرهای یک استان خاص
  async getCities(provinceId: string) {
    return this.prisma.location.findMany({
      where: { parentId: provinceId, type: 'CITY' },
      orderBy: { name: 'asc' },
      select: { id: true, name: true, slug: true },
    });
  }

  async getLocationBySlug(slug: string) {
    return findLocationBySlug(this.prisma, slug);
  }
}
