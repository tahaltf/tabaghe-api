import {
  Injectable,
} from '@nestjs/common';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { TtlCacheService } from '../../infrastructure/cache/ttl-cache.service';

import { parseListingTypesEnabledFromMap } from '../../common/system-settings/listing-type-enabled';
import {
  buildAcceptAttribute,
  formatTicketAttachmentLabels,
  parseTicketAttachmentMaxSizeMb,
  parseTicketAttachmentMimeTypes,
} from '../../common/upload/ticket-attachment-settings.util';
import {
  DEFAULT_ABOUT_US_FA,
  DEFAULT_FAQ_ITEMS,
  DEFAULT_FOOTER_TAGLINE_FA,
  DEFAULT_PRIVACY_POLICY_FA,
  DEFAULT_SELLER_TERMS_FA,
  DEFAULT_SYSTEM_INTRO_FA,
  DEFAULT_TERMS_CONDITIONS_FA,
  parseHeaderNavJson,
  parseHeaderActionsJson,
  parseFooterTextsJson,
  parseFooterQuickLinksJson,
} from '../../common/content';
import { getPwaAppName, getPwaAppShortName } from '../../common/pwa-brand-icon.util';
import { coerceLandingSections } from '../../common/landing/landing-sections.util';
import { normalizeLandingUrlPrefix } from '../../common/landing/landing-url.util';
import {
  INVITE_LANDING_SLUG,
  inviteLandingSeedDescription,
  inviteLandingSeedMeta,
  inviteLandingSeedTitle,
  loadInviteLandingSeedSections,
} from '../../common/landing/invite-landing.seed';
import {
  BUYER_LANDING_SLUG,
  buyerLandingSeedDescription,
  buyerLandingSeedMeta,
  buyerLandingSeedTitle,
  loadBuyerLandingSeedSections,
} from '../../common/landing/buyer-landing.seed';
import {
  SELLER_LANDING_SLUG,
  loadSellerLandingSeedSections,
  sellerLandingSeedDescription,
  sellerLandingSeedMeta,
  sellerLandingSeedTitle,
} from '../../common/landing/seller-landing.seed';
import { mergeHomepageLayout } from '../../common/homepage/homepage-layout.util';
import { AppSettingsService } from '../../shared/settings/app-settings.service';
import { parsePaymentGatewaysJson } from '../../modules/payments/payment-gateways.catalog';
import {
  migrateEnamadToLicenses,
  toPublicLicenses,
} from '../../common/content/site-licenses.util';

@Injectable()
export class CommonContentService {
  private static readonly SITE_SETTINGS_CACHE_TTL_SECONDS = 60;

  constructor(
    private readonly prisma: PrismaService,
    private readonly cache: TtlCacheService,
    private readonly appSettings: AppSettingsService,
  ) {}

  async getPublicSiteSettings() {
    return this.cache.getOrSet(
      'common:site-settings',
      CommonContentService.SITE_SETTINGS_CACHE_TTL_SECONDS,
      () => this.loadPublicSiteSettings(),
    );
  }

  async getPublicHomepageLayout() {
    return this.cache.getOrSet(
      'common:homepage-layout',
      CommonContentService.SITE_SETTINGS_CACHE_TTL_SECONDS,
      async () => {
        const row = await this.prisma.systemSetting.findUnique({
          where: { key: 'HOMEPAGE_LAYOUT' },
        });
        return mergeHomepageLayout(row?.value ?? null);
      },
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
      'HEADER_NAV_JSON',
      'HEADER_ACTIONS_JSON',
      'FOOTER_TEXTS_JSON',
      'FOOTER_QUICK_LINKS_JSON',
      'ENAMAD_ID',
      'ENAMAD_CODE',
      'ENAMAD_ENABLED',
      'SITE_LICENSES_JSON',
      'PAYMENT_GATEWAYS_JSON',
      'BUYER_CONFIRM_DEADLINE_MINUTES',
      'BUYER_CONFIRM_DEADLINE_DAYS',
      'LISTING_TYPE_DIRECT_ENABLED',
      'LISTING_TYPE_EXCHANGE_ENABLED',
      'LISTING_TYPE_AUCTION_ENABLED',
      'LISTING_REVIEW_SLA_HOURS',
      'TERMS_VERSION',
      'PWA_APP_NAME',
      'PWA_APP_SHORT_NAME',
      'PWA_APP_ICON',
      'PWA_APP_FAVICON',
      'FOOTER_TAGLINE',
      'LANDING_PAGES_URL_PREFIX',
      'CAMPAIGN_LINK_URL_PREFIX',
      'ADMIN_PANEL_BASE_PATH',
      'ADMIN_LOGIN_PATH',
      'TICKET_ATTACHMENT_ALLOWED_MIME_TYPES',
      'TICKET_ATTACHMENT_MAX_SIZE_MB',
      'THEME_VARIANT',
      'THEME_PALETTE',
      'THEME_PALETTE_LEGACY',
      'THEME_PALETTE_LEGACY_DARK',
      'THEME_PALETTE_PREMIUM',
      'THEME_PALETTE_PREMIUM_DARK',
      'THEME_PALETTE_OCEAN',
      'THEME_PALETTE_OCEAN_DARK',
      'THEME_PALETTE_FOREST',
      'THEME_PALETTE_FOREST_DARK',
      'THEME_PALETTE_SLATE',
      'THEME_PALETTE_SLATE_DARK',
      'THEME_PALETTE_ROSE',
      'THEME_PALETTE_ROSE_DARK',
      'THEME_PALETTE_MIDNIGHT',
      'THEME_PALETTE_MIDNIGHT_DARK',
      'OCCASION_THEME',
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
      map.USER_APP_LOGO_DARK,
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
      headerNav: parseHeaderNavJson(map.HEADER_NAV_JSON),
      headerActions: parseHeaderActionsJson(map.HEADER_ACTIONS_JSON),
      footerTexts: parseFooterTextsJson(map.FOOTER_TEXTS_JSON),
      footerQuickLinks: parseFooterQuickLinksJson(map.FOOTER_QUICK_LINKS_JSON),
      footerTagline:
        map.FOOTER_TAGLINE?.trim() || DEFAULT_FOOTER_TAGLINE_FA,
      ...(() => {
        const licenses = toPublicLicenses(
          migrateEnamadToLicenses({
            licensesJson: map.SITE_LICENSES_JSON,
            enamadId: map.ENAMAD_ID,
            enamadCode: map.ENAMAD_CODE,
            enamadEnabled: map.ENAMAD_ENABLED,
          }),
        );
        const firstEnamad = licenses.find((x) => x.kind === 'enamad');
        return {
          licenses,
          enamadId: firstEnamad?.enamadId?.trim() || '',
          enamadCode: firstEnamad?.enamadCode?.trim() || '',
          enamadEnabled: Boolean(firstEnamad),
        };
      })(),
      paymentGateways: (
        await (async () => {
          const fromDb = parsePaymentGatewaysJson(map.PAYMENT_GATEWAYS_JSON);
          const list =
            fromDb.length > 0
              ? fromDb
              : await this.appSettings.getPaymentGateways();
          return list
            .filter((g) => g.enabled)
            .map((g) => ({
              id: g.id,
              type: g.type,
              label: g.label,
            }));
        })()
      ),
      listingTypesEnabled: parseListingTypesEnabledFromMap(map),
      listingReviewSlaHours: (() => {
        const n = Number(map.LISTING_REVIEW_SLA_HOURS || '24');
        return Number.isFinite(n) && n > 0 ? Math.min(168, Math.floor(n)) : 24;
      })(),
      termsVersion: map.TERMS_VERSION?.trim() || '1',
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
      adminPanelBasePath: (() => {
        const raw = map.ADMIN_PANEL_BASE_PATH?.trim()
          .toLowerCase()
          .replace(/^\/+|\/+$/g, '');
        if (!raw) return 'admin';
        return /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(raw) &&
          raw.length >= 2 &&
          raw.length <= 40
          ? raw
          : 'admin';
      })(),
      adminLoginPath: (() => {
        const raw = map.ADMIN_LOGIN_PATH?.trim()
          .toLowerCase()
          .replace(/^\/+|\/+$/g, '');
        if (!raw) return 'admin-auth';
        return /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(raw) &&
          raw.length >= 2 &&
          raw.length <= 40
          ? raw
          : 'admin-auth';
      })(),
      ticketAttachmentSettings: (() => {
        const allowedMimeTypes = parseTicketAttachmentMimeTypes(
          map.TICKET_ATTACHMENT_ALLOWED_MIME_TYPES,
        );
        const maxSizeMb = parseTicketAttachmentMaxSizeMb(
          map.TICKET_ATTACHMENT_MAX_SIZE_MB,
        );
        return {
          allowedMimeTypes,
          maxSizeMb,
          accept: buildAcceptAttribute(allowedMimeTypes),
          labels: formatTicketAttachmentLabels(allowedMimeTypes),
        };
      })(),
      themeVariant: map.THEME_VARIANT?.trim() || null,
      themePalette: map.THEME_PALETTE?.trim() || null,
      themeCustomPalettes: map.THEME_CUSTOM_PALETTES?.trim() || null,
      themePaletteLegacy: map.THEME_PALETTE_LEGACY?.trim() || null,
      themePaletteLegacyDark: map.THEME_PALETTE_LEGACY_DARK?.trim() || null,
      themePalettePremium: map.THEME_PALETTE_PREMIUM?.trim() || null,
      themePalettePremiumDark: map.THEME_PALETTE_PREMIUM_DARK?.trim() || null,
      themePaletteClassic: map.THEME_PALETTE_CLASSIC?.trim() || null,
      themePaletteClassicDark: map.THEME_PALETTE_CLASSIC_DARK?.trim() || null,
      themePaletteRoyal: map.THEME_PALETTE_ROYAL?.trim() || null,
      themePaletteRoyalDark: map.THEME_PALETTE_ROYAL_DARK?.trim() || null,
      themePaletteEmerald: map.THEME_PALETTE_EMERALD?.trim() || null,
      themePaletteEmeraldDark: map.THEME_PALETTE_EMERALD_DARK?.trim() || null,
      themePaletteSapphire: map.THEME_PALETTE_SAPPHIRE?.trim() || null,
      themePaletteSapphireDark: map.THEME_PALETTE_SAPPHIRE_DARK?.trim() || null,
      themePaletteAurora: map.THEME_PALETTE_AURORA?.trim() || null,
      themePaletteAuroraDark: map.THEME_PALETTE_AURORA_DARK?.trim() || null,
      themePaletteGraphite: map.THEME_PALETTE_GRAPHITE?.trim() || null,
      themePaletteGraphiteDark: map.THEME_PALETTE_GRAPHITE_DARK?.trim() || null,
      themePaletteSunset: map.THEME_PALETTE_SUNSET?.trim() || null,
      themePaletteSunsetDark: map.THEME_PALETTE_SUNSET_DARK?.trim() || null,
      themePaletteOcean: map.THEME_PALETTE_OCEAN?.trim() || null,
      themePaletteOceanDark: map.THEME_PALETTE_OCEAN_DARK?.trim() || null,
      themePaletteForest: map.THEME_PALETTE_FOREST?.trim() || null,
      themePaletteForestDark: map.THEME_PALETTE_FOREST_DARK?.trim() || null,
      themePaletteSlate: map.THEME_PALETTE_SLATE?.trim() || null,
      themePaletteSlateDark: map.THEME_PALETTE_SLATE_DARK?.trim() || null,
      themePaletteRose: map.THEME_PALETTE_ROSE?.trim() || null,
      themePaletteRoseDark: map.THEME_PALETTE_ROSE_DARK?.trim() || null,
      themePaletteMidnight: map.THEME_PALETTE_MIDNIGHT?.trim() || null,
      themePaletteMidnightDark: map.THEME_PALETTE_MIDNIGHT_DARK?.trim() || null,
      occasionTheme: map.OCCASION_THEME?.trim() || null,
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

  async getPrivacyPolicy() {
    const row = await this.prisma.systemSetting.findUnique({
      where: { key: 'PRIVACY_POLICY' },
      select: { value: true, updatedAt: true },
    });
    return {
      content: row?.value?.trim() || DEFAULT_PRIVACY_POLICY_FA,
      updatedAt: row?.updatedAt ?? null,
    };
  }

  async getSellerTerms() {
    const row = await this.prisma.systemSetting.findUnique({
      where: { key: 'SELLER_TERMS' },
      select: { value: true, updatedAt: true },
    });
    return {
      content: row?.value?.trim() || DEFAULT_SELLER_TERMS_FA,
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
    if (page) {
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

    if (slug === INVITE_LANDING_SLUG) {
      return {
        id: 'fallback-invite',
        slug: INVITE_LANDING_SLUG,
        title: inviteLandingSeedTitle(),
        description: inviteLandingSeedDescription(),
        sections: loadInviteLandingSeedSections(),
        meta: inviteLandingSeedMeta(),
        updatedAt: new Date(),
      };
    }

    if (slug === SELLER_LANDING_SLUG) {
      return {
        id: 'fallback-seller',
        slug: SELLER_LANDING_SLUG,
        title: sellerLandingSeedTitle(),
        description: sellerLandingSeedDescription(),
        sections: loadSellerLandingSeedSections(),
        meta: sellerLandingSeedMeta(),
        updatedAt: new Date(),
      };
    }

    if (slug === BUYER_LANDING_SLUG) {
      return {
        id: 'fallback-buyer',
        slug: BUYER_LANDING_SLUG,
        title: buyerLandingSeedTitle(),
        description: buyerLandingSeedDescription(),
        sections: loadBuyerLandingSeedSections(),
        meta: buyerLandingSeedMeta(),
        updatedAt: new Date(),
      };
    }

    return null;
  }

}
