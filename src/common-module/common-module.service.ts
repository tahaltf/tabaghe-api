import { Injectable } from '@nestjs/common';
import { PrismaService } from "../infrastructure/prisma/prisma.service";

@Injectable()
export class CommonService {
  constructor(private prisma: PrismaService) {}

  // دریافت لیست استان‌ها (به ترتیب حروف الفبا)
  async getProvinces() {
    return this.prisma.location.findMany({
      where: { type: 'PROVINCE' },
      orderBy: { name: 'asc' },
      select: { id: true, name: true }
    });
  }

  // دریافت شهرهای یک استان خاص
  async getCities(provinceId: string) {
    return this.prisma.location.findMany({
      where: { parentId: provinceId, type: 'CITY' },
      orderBy: { name: 'asc' },
      select: { id: true, name: true }
    });
  }

  // دریافت دسته‌بندی‌ها (فقط دسته‌های اصلی)
  async getCategories() {
    return this.prisma.category.findMany({
      where: { parentId: null },
      orderBy: { title: 'asc' },
      select: { id: true, title: true, slug: true }
    });
  }
}