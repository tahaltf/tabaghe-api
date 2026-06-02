import {
  BadRequestException,
  ConflictException,
  Injectable,
} from '@nestjs/common';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { findLocationBySlug } from '../location-slug.util';


@Injectable()
export class CommonLocationService {
  constructor(private readonly prisma: PrismaService) {}

  async getProvinces() {
    return this.prisma.location.findMany({
      where: { type: 'PROVINCE' },
      orderBy: { name: 'asc' },
      select: { id: true, name: true, slug: true },
    });
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
