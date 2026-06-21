import {
  Injectable,
} from '@nestjs/common';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { TtlCacheService } from '../../infrastructure/cache/ttl-cache.service';

import { parseListingTypesEnabledFromMap } from '../../common/system-settings/listing-type-enabled';
import {
  DEFAULT_ABOUT_US_FA,
  DEFAULT_FAQ_ITEMS,
  DEFAULT_FOOTER_TAGLINE_FA,
  DEFAULT_SYSTEM_INTRO_FA,
  DEFAULT_TERMS_CONDITIONS_FA,
} from '../../common/content';
import { getPwaAppName, getPwaAppShortName } from '../../common/pwa-brand-icon.util';
import { coerceLandingSections } from '../../common/landing/landing-sections.util';
import { normalizeLandingUrlPrefix } from '../../common/landing/landing-url.util';

@Injectable()
export class CommonContentService {
  private static readonly SITE_SETTINGS_CACHE_TTL_SECONDS = 60;

  constructor(
    private readonly prisma: PrismaService,
    private readonly cache: TtlCacheService,
  ) {}

  async getPublicSiteSettings() {
    return this.cache.getOrSet(
      'common:site-settings',
      CommonContentService.SITE_SETTINGS_CACHE_TTL_SECONDS,
      () => this.loadPublicSiteSettings(),
    );
  }

  private async loadPublicSiteSettings() {
    const PUBLIC_KEYS = [
      'HOMEPAGE_BANNER',
      'MEDIA_FALLBACK_LOGO',
      'USER_APP_LOGO',
      'USER_APP_LOGO_LIGHT',
      'USER_APP_LOGO_DARK',
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
      'BUYER_CONFIRM_DEADLINE_MINUTES',
      'BUYER_CONFIRM_DEADLINE_DAYS',
      'LISTING_TYPE_DIRECT_ENABLED',
      'LISTING_TYPE_EXCHANGE_ENABLED',
      'LISTING_TYPE_AUCTION_ENABLED',
      'PWA_APP_NAME',
      'PWA_APP_SHORT_NAME',
      'PWA_APP_ICON',
      'PWA_APP_FAVICON',
      'FOOTER_TAGLINE',
      'LANDING_PAGES_URL_PREFIX',
      'CAMPAIGN_LINK_URL_PREFIX',
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

    const defaultBuyerConfirmMinutes = 4 * 24 * 60;
    let buyerConfirmDeadlineMinutes = defaultBuyerConfirmMinutes;
    const buyerMinutesRaw = map.BUYER_CONFIRM_DEADLINE_MINUTES?.trim();
    const buyerDaysRaw = map.BUYER_CONFIRM_DEADLINE_DAYS?.trim();
    if (buyerMinutesRaw) {
      const parsed = Number(buyerMinutesRaw.replace(/[^\d]/g, ''));
      if (Number.isFinite(parsed) && parsed > 0) {
        buyerConfirmDeadlineMinutes = parsed;
      }
    } else if (buyerDaysRaw) {
      const parsed = Number(buyerDaysRaw.replace(/[^\d]/g, ''));
      if (Number.isFinite(parsed) && parsed > 0) {
        buyerConfirmDeadlineMinutes = parsed * 24 * 60;
      }
    }

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
          const network = String((item as { network?: string }).network ?? '')
            .trim()
            .toLowerCase();
          const urlRaw = String((item as { url?: string }).url ?? '').trim();
          if (!allowedSocial.has(network) || !urlRaw) continue;
          let url = urlRaw;
          if (!/^https?:\/\//i.test(url)) {
            url = url.startsWith('//')
              ? `https:${url}`
              : `https://${url.replace(/^\/+/, '')}`;
          }
          if (/^https?:\/\//i.test(url))
            footerSocialLinks.push({ network, url });
        }
      }
    } catch {
      // ignore
    }

    const legacyUserLogo = map.USER_APP_LOGO?.trim() || null;
    const rawLight = map.USER_APP_LOGO_LIGHT?.trim() || null;
    const rawDark = map.USER_APP_LOGO_DARK?.trim() || null;
    const userAppLogoLight = rawLight || legacyUserLogo;
    const userAppLogoDark = rawDark || legacyUserLogo;

    const pwaAppName =
      (await getPwaAppName(this.prisma)) || 'طبقه';
    const pwaAppShortName =
      (await getPwaAppShortName(this.prisma)) || pwaAppName;
    const pwaIconVersion = [
      map.PWA_APP_ICON,
      map.PWA_APP_FAVICON,
      map.USER_APP_LOGO_LIGHT,
      map.USER_APP_LOGO,
    ]
      .map((v) => v?.trim())
      .filter(Boolean)
      .join('|');

    return {
      homepageBanner: map.HOMEPAGE_BANNER || null,
      mediaFallbackLogo: map.MEDIA_FALLBACK_LOGO || null,
      /** @deprecated برای سازگاری؛ همان لوگوی تم روشن یا قدیمی */
      userAppLogo: userAppLogoLight,
      userAppLogoLight,
      userAppLogoDark,
      pwaAppName,
      pwaAppShortName,
      pwaIconVersion,
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
      buyerConfirmDeadlineMinutes,
      footerSocialLinks,
      footerTagline:
        map.FOOTER_TAGLINE?.trim() || DEFAULT_FOOTER_TAGLINE_FA,
      listingTypesEnabled: parseListingTypesEnabledFromMap(map),
      landingPagesUrlPrefix: (() => {
        const raw = map.LANDING_PAGES_URL_PREFIX?.trim()
          .toLowerCase()
          .replace(/^\/+|\/+$/g, '');
        if (!raw) return 'p';
        return /^[a-z0-9-]+$/.test(raw) ? raw : 'p';
      })(),
      campaignLinkUrlPrefix: (() => {
        const raw = map.CAMPAIGN_LINK_URL_PREFIX?.trim()
          .toLowerCase()
          .replace(/^\/+|\/+$/g, '');
        if (!raw) return 'ref';
        return /^[a-z0-9-]+$/.test(raw) ? raw : 'ref';
      })(),
    };
  }

  /** متن قوانین و مقررات برای نمایش عمومی */
  async getTermsAndConditions() {
    const row = await this.prisma.systemSetting.findUnique({
      where: { key: 'TERMS_CONDITIONS' },
      select: { value: true, updatedAt: true },
    });
    return {
      content: row?.value?.trim() || DEFAULT_TERMS_CONDITIONS_FA,
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
      content: row?.value?.trim() || DEFAULT_ABOUT_US_FA,
      updatedAt: row?.updatedAt ?? null,
    };
  }

  /** سوالات متداول (برای نمایش عمومی) */
  async getFaqs() {
    const rows = await this.prisma.faq.findMany({
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
    if (rows.length > 0) return rows;

    return DEFAULT_FAQ_ITEMS.map((item, index) => ({
      id: `default-faq-${index}`,
      question: item.question,
      answer: item.answer,
      category: item.category,
      order: item.order,
    }));
  }

  async getIntroduction() {
    const row = await this.prisma.systemSetting.findUnique({
      where: { key: 'SYSTEM_INTRO_CONTENT' },
      select: { value: true, updatedAt: true },
    });
    return {
      content: row?.value?.trim() || DEFAULT_SYSTEM_INTRO_FA,
      updatedAt: row?.updatedAt ?? null,
    };
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

  async getLandingPageBySlug(slug: string) {
    const page = await this.prisma.landingPage.findFirst({
      where: { slug, isPublished: true },
    });
    if (!page) return null;
    return {
      id: page.id,
      slug: page.slug,
      title: page.title,
      description: page.description,
      sections: coerceLandingSections(page.sections),
      meta:
        page.meta && typeof page.meta === 'object' && !Array.isArray(page.meta)
          ? page.meta
          : null,
      updatedAt: page.updatedAt,
    };
  }

}
