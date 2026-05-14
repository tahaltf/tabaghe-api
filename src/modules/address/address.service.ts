import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';

@Injectable()
export class AddressService {
  constructor(private prisma: PrismaService) {}

  async getMyAddresses(userId: string) {
    return this.prisma.address.findMany({
      where: { userId },
      orderBy: { createdAt: 'desc' },
    });
  }

  async createAddress(userId: string, dto: any) {
    return this.prisma.address.create({
      data: {
        userId,
        title: dto.title,
        province: dto.province,
        city: dto.city,
        fullAddress: dto.fullAddress,
        postalCode: dto.postalCode,
        phone: dto.phone, // ✅ دقیقاً با فرانت‌اِند مچ شد
      },
    });
  }

  async updateAddress(userId: string, id: string, dto: any) {
    // بررسی امنیتی: آیا آدرس برای این کاربر است؟
    const address = await this.prisma.address.findFirst({
      where: { id, userId },
    });

    if (!address)
      throw new NotFoundException('آدرس یافت نشد یا متعلق به شما نیست');

    return this.prisma.address.update({
      where: { id },
      data: {
        title: dto.title,
        province: dto.province,
        city: dto.city,
        fullAddress: dto.fullAddress,
        postalCode: dto.postalCode,
        phone: dto.phone, // ✅ دقیقاً با فرانت‌اِند مچ شد
      },
    });
  }

  async deleteAddress(userId: string, id: string) {
    const address = await this.prisma.address.findFirst({
      where: { id, userId },
    });

    if (!address) throw new NotFoundException('آدرس یافت نشد');

    return this.prisma.address.delete({
      where: { id },
    });
  }
}
