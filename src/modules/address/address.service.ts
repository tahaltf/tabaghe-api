import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { ZohalService } from '../zohal/zohal.service';
import { ZohalSettingsService } from '../zohal/zohal-settings.service';
import type { PostalLookupResult } from '../zohal/zohal-settings.constants';

@Injectable()
export class AddressService {
  constructor(
    private prisma: PrismaService,
    private readonly zohal: ZohalService,
    private readonly zohalSettings: ZohalSettingsService,
  ) {}

  async getInquiryConfig(): Promise<{ active: boolean }> {
    return { active: await this.zohalSettings.isPostalActive() };
  }

  async lookupPostalCode(postalCode: string, userId?: string): Promise<PostalLookupResult> {
    if (!(await this.zohalSettings.isPostalActive())) {
      return { ok: false, manual: true, reason: 'disabled' };
    }

    try {
      const result = await this.zohal.lookupPostalCode(postalCode, userId);
      return {
        ok: true,
        province: result.province,
        city: result.city,
        district: result.district,
        fullAddress: result.fullAddress,
      };
    } catch {
      return { ok: false, manual: true, reason: 'inquiry_failed' };
    }
  }

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
        phone: dto.phone,
        fromInquiry: Boolean(dto.fromInquiry),
      },
    });
  }

  async updateAddress(userId: string, id: string, dto: any) {
    const address = await this.prisma.address.findFirst({
      where: { id, userId },
    });

    if (!address) {
      throw new NotFoundException('آدرس یافت نشد یا متعلق به شما نیست');
    }

    return this.prisma.address.update({
      where: { id },
      data: {
        title: dto.title,
        phone: dto.phone,
        ...(address.fromInquiry
          ? {}
          : {
              province: dto.province,
              city: dto.city,
              fullAddress: dto.fullAddress,
              postalCode: dto.postalCode,
              fromInquiry: Boolean(dto.fromInquiry),
            }),
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
