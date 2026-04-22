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

  // دریافت دسته‌بندی‌ها (فقط دسته‌های اصلی به همراه زیردسته‌ها)
  async getCategories() {
    return this.prisma.category.findMany({
      where: { parentId: null },
      orderBy: { title: 'asc' },
      select: {
        id: true,
        title: true,
        slug: true,
        icon: true,
        children: {
          orderBy: { title: 'asc' },
          select: { id: true, title: true, slug: true, icon: true, parentId: true },
        },
      },
    });
  }

  // دسته‌بندی‌های مجاز برای تعمیرات (قابل تنظیم توسط ادمین)
  async getRepairCategories() {
    const allowedSetting = await this.prisma.systemSetting.findUnique({
      where: { key: 'REPAIR_ALLOWED_CATEGORY_IDS' },
      select: { value: true },
    });

    const all = await this.getCategories();
    if (!allowedSetting) return all;
    if (!allowedSetting.value?.trim()) return [];

    let allowedIds: string[] = [];
    try {
      const parsed = JSON.parse(allowedSetting.value);
      if (Array.isArray(parsed)) {
        allowedIds = parsed.filter((x): x is string => typeof x === 'string');
      }
    } catch {
      allowedIds = [];
    }
    if (!allowedIds.length) return [];

    const set = new Set(allowedIds);
    return all
      .map((root) => {
        const selfAllowed = set.has(root.id);
        const children = (root.children ?? []).filter((c) => set.has(c.id));
        if (!selfAllowed && !children.length) return null;
        return {
          ...root,
          children,
        };
      })
      .filter(Boolean);
  }

  // تنظیمات عمومی سایت که برای کاربران عادی هم باید در دسترس باشه
  async getPublicSiteSettings() {
    const PUBLIC_KEYS = [
      'HOMEPAGE_BANNER',
      'SUPPORT_PHONE',
      'SUPPORT_EMAIL',
      'PLATFORM_ADDRESS',
      'PLATFORM_LATITUDE',
      'PLATFORM_LONGITUDE',
      'VERIFICATION_FEE',
      'SHIPPING_COST',
    ];

    const rows = await this.prisma.systemSetting.findMany({
      where: { key: { in: PUBLIC_KEYS } },
      select: { key: true, value: true },
    });

    const map: Record<string, string> = {};
    for (const key of PUBLIC_KEYS) map[key] = '';
    for (const row of rows) map[row.key] = row.value;

    return {
      homepageBanner: map.HOMEPAGE_BANNER || null,
      supportPhone: map.SUPPORT_PHONE || null,
      supportEmail: map.SUPPORT_EMAIL || null,
      platformAddress: map.PLATFORM_ADDRESS || null,
      platformLatitude: map.PLATFORM_LATITUDE ? Number(map.PLATFORM_LATITUDE) : null,
      platformLongitude: map.PLATFORM_LONGITUDE ? Number(map.PLATFORM_LONGITUDE) : null,
      verificationFee: map.VERIFICATION_FEE ? Number(map.VERIFICATION_FEE) : 0,
      shippingCost: map.SHIPPING_COST ? Number(map.SHIPPING_COST) : 0,
    };
  }

  /** متن قوانین و مقررات برای نمایش عمومی */
  async getTermsAndConditions() {
    const row = await this.prisma.systemSetting.findUnique({
      where: { key: 'TERMS_CONDITIONS' },
      select: { value: true, updatedAt: true },
    });
    return {
      content: row?.value ?? '',
      updatedAt: row?.updatedAt ?? null,
    };
  }

  /** متن درباره ما برای نمایش عمومی */
  async getAboutUs() {
    const row = await this.prisma.systemSetting.findUnique({
      where: { key: 'ABOUT_US' },
      select: { value: true, updatedAt: true },
    });
    return {
      content: row?.value ?? '',
      updatedAt: row?.updatedAt ?? null,
    };
  }

  /** سوالات متداول (برای نمایش عمومی) */
  async getFaqs() {
    return this.prisma.faq.findMany({
      where: { isActive: true },
      orderBy: [{ order: 'asc' }, { createdAt: 'asc' }],
      select: {
        id: true,
        question: true,
        answer: true,
        category: true,
        order: true,
      },
    });
  }
}