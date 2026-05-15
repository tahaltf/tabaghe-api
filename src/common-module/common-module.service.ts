import { Injectable } from '@nestjs/common';
import { ListingStatus, NotificationType } from '@prisma/client';
import { PrismaService } from '../infrastructure/prisma/prisma.service';
import { NotificationService } from '../modules/notification/notification.service';

@Injectable()
export class CommonService {
  constructor(
    private prisma: PrismaService,
    private readonly notifications: NotificationService,
  ) {}

  // دریافت لیست استان‌ها (به ترتیب حروف الفبا)
  async getProvinces() {
    return this.prisma.location.findMany({
      where: { type: 'PROVINCE' },
      orderBy: { name: 'asc' },
      select: { id: true, name: true },
    });
  }

  // دریافت شهرهای یک استان خاص
  async getCities(provinceId: string) {
    return this.prisma.location.findMany({
      where: { parentId: provinceId, type: 'CITY' },
      orderBy: { name: 'asc' },
      select: { id: true, name: true },
    });
  }

  // دریافت دسته‌بندی‌ها — درخت کامل (هر عمق) + تعداد آگهی تأییدشده در هر شاخه
  async getCategories() {
    const rows = await this.prisma.category.findMany({
      orderBy: { title: 'asc' },
      select: {
        id: true,
        title: true,
        slug: true,
        icon: true,
        parentId: true,
      },
    });
    const rollup = await this.getApprovedListingRollupCounts();
    const tree = this.buildCategoryTree(rows, null);
    return this.attachListingCounts(tree, rollup);
  }

  /** فقط دسته‌های ریشه‌ای که در خود یا زیرشاخه‌شان آگهی دارند (صفحه اصلی) */
  async getHomeCategories() {
    const tree = await this.getCategories();
    return tree.filter((c) => (c.listingCount ?? 0) > 0);
  }

  private async getApprovedListingRollupCounts(): Promise<Map<string, number>> {
    const grouped = await this.prisma.listing.groupBy({
      by: ['categoryId'],
      where: { status: ListingStatus.APPROVED },
      _count: { _all: true },
    });
    const direct = new Map(
      grouped.map((g) => [g.categoryId, g._count._all]),
    );
    const rows = await this.prisma.category.findMany({
      select: { id: true, parentId: true },
    });
    const childrenByParent = new Map<string | null, string[]>();
    for (const r of rows) {
      const key = r.parentId;
      const list = childrenByParent.get(key) ?? [];
      list.push(r.id);
      childrenByParent.set(key, list);
    }
    const rollup = new Map<string, number>();
    const compute = (id: string): number => {
      if (rollup.has(id)) return rollup.get(id)!;
      let total = direct.get(id) ?? 0;
      for (const childId of childrenByParent.get(id) ?? []) {
        total += compute(childId);
      }
      rollup.set(id, total);
      return total;
    };
    for (const r of rows) compute(r.id);
    return rollup;
  }

  private attachListingCounts(nodes: any[], rollup: Map<string, number>): any[] {
    return nodes.map((node) => {
      const rawChildren = Array.isArray(node.children) ? node.children : [];
      const children = rawChildren.length
        ? this.attachListingCounts(rawChildren, rollup)
        : undefined;
      return {
        ...node,
        listingCount: rollup.get(node.id) ?? 0,
        ...(children?.length ? { children } : {}),
      };
    });
  }

  private buildCategoryTree<
    T extends {
      id: string;
      title: string;
      slug: string;
      icon: string | null;
      parentId: string | null;
    },
  >(rows: T[], parentId: string | null): Array<
    T & { children?: Array<T & { children?: unknown[] }> }
  > {
    return rows
      .filter((r) => r.parentId === parentId)
      .map((row) => {
        const children = this.buildCategoryTree(rows, row.id);
        return {
          ...row,
          ...(children.length ? { children } : {}),
        };
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
      'MEDIA_FALLBACK_LOGO',
      'USER_APP_LOGO',
      'CRITICAL_ALERT_ENABLED',
      'CRITICAL_ALERT_LABEL',
      'CRITICAL_ALERT_TEXT',
      'CRITICAL_ALERT_BG_COLOR',
      'CRITICAL_ALERT_TEXT_COLOR',
      'SUPPORT_PHONE',
      'SUPPORT_EMAIL',
      'PLATFORM_ADDRESS',
      'PLATFORM_ADDRESSES',
      'PLATFORM_LATITUDE',
      'PLATFORM_LONGITUDE',
      'VERIFICATION_FEE',
      'SHIPPING_COST',
      'BANK_CARD_NUMBER',
      'BANK_ACCOUNT_HOLDER',
      'BANK_SHABA',
      'MANUAL_CARD_TRANSFER_MAX',
      'FOOTER_SOCIAL_LINKS',
    ];

    const rows = await this.prisma.systemSetting.findMany({
      where: { key: { in: PUBLIC_KEYS } },
      select: { key: true, value: true },
    });

    const map: Record<string, string> = {};
    for (const key of PUBLIC_KEYS) map[key] = '';
    for (const row of rows) map[row.key] = row.value;

    let platformAddresses: Array<{
      id: string;
      label: string;
      address: string;
      postalCode: string;
    }> = [];
    try {
      const parsed = JSON.parse(map.PLATFORM_ADDRESSES || '[]');
      if (Array.isArray(parsed)) {
        platformAddresses = parsed
          .map((x, idx) => ({
            id:
              typeof x?.id === 'string' && x.id.trim()
                ? x.id.trim()
                : `addr-${idx + 1}`,
            label: typeof x?.label === 'string' ? x.label.trim() : '',
            address: typeof x?.address === 'string' ? x.address.trim() : '',
            postalCode:
              typeof x?.postalCode === 'string'
                ? x.postalCode.replace(/[^\d]/g, '')
                : '',
          }))
          .filter((x) => x.address);
      }
    } catch {
      platformAddresses = [];
    }

    const primaryAddress =
      map.PLATFORM_ADDRESS || platformAddresses[0]?.address || null;

    const allowedSocial = new Set([
      'instagram',
      'telegram',
      'whatsapp',
      'youtube',
      'linkedin',
      'twitter',
      'aparat',
      'eitaa',
      'rubika',
      'github',
      'website',
    ]);
    const footerSocialLinks: Array<{ network: string; url: string }> = [];
    try {
      const parsed = JSON.parse(map.FOOTER_SOCIAL_LINKS || '[]');
      if (Array.isArray(parsed)) {
        for (const item of parsed) {
          if (!item || typeof item !== 'object') continue;
          const network = String(
            (item as { network?: string }).network ?? '',
          )
            .trim()
            .toLowerCase();
          const urlRaw = String((item as { url?: string }).url ?? '').trim();
          if (!allowedSocial.has(network) || !urlRaw) continue;
          let url = urlRaw;
          if (!/^https?:\/\//i.test(url)) {
            url = url.startsWith('//') ? `https:${url}` : `https://${url.replace(/^\/+/, '')}`;
          }
          if (/^https?:\/\//i.test(url)) footerSocialLinks.push({ network, url });
        }
      }
    } catch {
      // ignore
    }

    return {
      homepageBanner: map.HOMEPAGE_BANNER || null,
      mediaFallbackLogo: map.MEDIA_FALLBACK_LOGO || null,
      userAppLogo: map.USER_APP_LOGO || null,
      criticalAlertEnabled: map.CRITICAL_ALERT_ENABLED === 'true',
      criticalAlertLabel: map.CRITICAL_ALERT_LABEL || null,
      criticalAlertText: map.CRITICAL_ALERT_TEXT || null,
      criticalAlertBgColor: map.CRITICAL_ALERT_BG_COLOR || '#ef4444',
      criticalAlertTextColor: map.CRITICAL_ALERT_TEXT_COLOR || '#ffffff',
      supportPhone: map.SUPPORT_PHONE || null,
      supportEmail: map.SUPPORT_EMAIL || null,
      platformAddress: primaryAddress,
      platformAddresses,
      platformLatitude: map.PLATFORM_LATITUDE
        ? Number(map.PLATFORM_LATITUDE)
        : null,
      platformLongitude: map.PLATFORM_LONGITUDE
        ? Number(map.PLATFORM_LONGITUDE)
        : null,
      verificationFee: map.VERIFICATION_FEE ? Number(map.VERIFICATION_FEE) : 0,
      shippingCost: map.SHIPPING_COST ? Number(map.SHIPPING_COST) : 0,
      bankCardNumber: map.BANK_CARD_NUMBER || null,
      bankAccountHolder: map.BANK_ACCOUNT_HOLDER || null,
      bankShaba: map.BANK_SHABA || null,
      manualCardTransferMax: map.MANUAL_CARD_TRANSFER_MAX
        ? Number(map.MANUAL_CARD_TRANSFER_MAX)
        : 10000000,
      footerSocialLinks,
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

  async getIntroduction() {
    const row = await this.prisma.systemSetting.findUnique({
      where: { key: 'SYSTEM_INTRO_CONTENT' },
      select: { value: true, updatedAt: true },
    });
    return { content: row?.value ?? '', updatedAt: row?.updatedAt ?? null };
  }

  async getBlogPosts() {
    const rows = await this.prisma.blogPost.findMany({
      where: { isPublished: true },
      orderBy: { createdAt: 'desc' },
    });
    return rows.map((x) => ({
      id: x.id,
      slug: x.slug,
      title: x.title,
      description: x.description,
      excerpt: x.description,
      content: x.description,
      image: x.image ?? null,
      outline: x.outline ?? null,
      note: x.note ?? null,
      createdAt: x.createdAt,
      updatedAt: x.updatedAt,
    }));
  }

  async getBlogPostBySlug(slug: string) {
    const post = await this.prisma.blogPost.findFirst({
      where: { slug, isPublished: true },
    });
    if (!post) return null;
    return {
      id: post.id,
      slug: post.slug,
      title: post.title,
      description: post.description,
      excerpt: post.description,
      content: post.description,
      image: post.image ?? null,
      outline: post.outline ?? null,
      note: post.note ?? null,
      createdAt: post.createdAt,
      updatedAt: post.updatedAt,
    };
  }

  async submitContactMessage(payload: {
    name: string;
    phone: string;
    email?: string;
    subject: string;
    message: string;
  }) {
    const key = `CONTACT_MESSAGE_${Date.now()}_${Math.floor(Math.random() * 10000)}`;
    const value = JSON.stringify({
      ...payload,
      createdAt: new Date().toISOString(),
    });
    await this.prisma.systemSetting.create({
      data: {
        key,
        value,
        description: 'Public contact form submission',
      },
    });
    void this.notifications
      .notifyAdminPersonnel({
        type: NotificationType.ADMIN_ALERT_CONTACT_MESSAGE,
        title: 'پیام تماس با ما',
        message: `${payload.name} — ${payload.subject}`,
        meta: {
          contactKey: key,
          name: payload.name,
          phone: payload.phone,
          email: payload.email ?? '',
          subject: payload.subject,
        },
      })
      .catch(() => undefined);
    return { ok: true };
  }
}
