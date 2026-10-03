/** پیش‌فرض‌های قابل تنظیم هدر/فوتر سایت عمومی */

export type ListingTypeGate = 'DIRECT' | 'EXCHANGE' | 'AUCTION';

export type HeaderNavItem = {
  id: string;
  label: string;
  link: string;
  /** اگر ست شود به queryParams.type تبدیل می‌شود */
  queryType?: ListingTypeGate | '';
  enabled: boolean;
  isSpecial?: boolean;
  /** دکمهٔ متمایز انتهای منو (مثلاً فروشنده شوید) */
  isCta?: boolean;
  requiresType?: ListingTypeGate | '';
};

export type HeaderActionsConfig = {
  cartIcon: string;
  showCart: boolean;
  showThemeToggle: boolean;
  showCta: boolean;
  ctaLabel: string;
  ctaMobileLabel: string;
  cartLabel: string;
  ctaLink: string;
};

export type FooterTextsConfig = {
  clubTitle: string;
  clubPlaceholder: string;
  clubButton: string;
  clubLoading: string;
  brandTitle: string;
  brandDot: string;
  watermark: string;
  quickLinksTitle: string;
  trustTitle: string;
  popularCategoriesTitle: string;
  copyright: string;
};

export type FooterQuickLinkItem = {
  id: string;
  label: string;
  link: string;
  queryType?: ListingTypeGate | '';
  icon: string;
  enabled: boolean;
  requiresType?: ListingTypeGate | '';
};

export const DEFAULT_HEADER_NAV: HeaderNavItem[] = [
  { id: 'listings', label: 'آگهی‌ها', link: '/listings', enabled: true },
  {
    id: 'auctions',
    label: 'مزایده‌ها',
    link: '/listings',
    queryType: 'AUCTION',
    enabled: true,
    isSpecial: true,
    requiresType: 'AUCTION',
  },
  { id: 'plans', label: 'ظرفیت و پلن‌ها', link: '/plans', enabled: true },
  { id: 'help', label: 'راهنما', link: '/help', enabled: true },
];

export const DEFAULT_HEADER_ACTIONS: HeaderActionsConfig = {
  cartIcon: 'heroShoppingCart',
  showCart: true,
  showThemeToggle: true,
  showCta: true,
  ctaLabel: '+ ثبت آگهی',
  ctaMobileLabel: '+ ثبت آگهی جدید',
  cartLabel: 'سبد خرید',
  ctaLink: '/dashboard/create-listing',
};

export const DEFAULT_FOOTER_TEXTS: FooterTextsConfig = {
  clubTitle: 'عضویت در باشگاه مشتریان',
  clubPlaceholder: 'شماره موبایل (۰۹۱۲۳۴۵۶۷۸۹)',
  clubButton: 'عضویت',
  clubLoading: 'در حال عضویت...',
  brandTitle: 'طبقه',
  brandDot: '.',
  watermark: 'TABAGHEH',
  quickLinksTitle: 'دسترسی سریع',
  trustTitle: 'اعتماد شما',
  popularCategoriesTitle: 'دسته‌های پرطرفدار',
  copyright: 'تمام حقوق برای شرکت نوآوران تجارت طبقه محفوظ است',
};

export const DEFAULT_FOOTER_QUICK_LINKS: FooterQuickLinkItem[] = [
  {
    id: 'direct',
    label: 'خرید مستقیم',
    link: '/listings',
    queryType: 'DIRECT',
    icon: 'heroShoppingBag',
    enabled: true,
    requiresType: 'DIRECT',
  },
  {
    id: 'auction',
    label: 'تالار مزایده‌ها',
    link: '/listings',
    queryType: 'AUCTION',
    icon: 'heroBolt',
    enabled: true,
    requiresType: 'AUCTION',
  },
  {
    id: 'exchange',
    label: 'معاوضه کالا',
    link: '/listings',
    queryType: 'EXCHANGE',
    icon: 'heroArrowsRightLeft',
    enabled: true,
    requiresType: 'EXCHANGE',
  },
  {
    id: 'repairs',
    label: 'تعمیرات',
    link: '/dashboard/repairs',
    icon: 'heroWrenchScrewdriver',
    enabled: true,
  },
  {
    id: 'plans',
    label: 'تعرفه و پلن‌ها',
    link: '/plans',
    icon: 'heroCreditCard',
    enabled: true,
  },
  {
    id: 'categories',
    label: 'همه دسته‌بندی‌ها',
    link: '/categories',
    icon: 'heroSquares2x2',
    enabled: true,
  },
  {
    id: 'locations',
    label: 'شهرها و استان‌ها',
    link: '/locations',
    icon: 'heroMapPin',
    enabled: true,
  },
  {
    id: 'introduction',
    label: 'چگونه کار می‌کند',
    link: '/introduction',
    icon: 'heroSparkles',
    enabled: true,
  },
  {
    id: 'help',
    label: 'راهنمای شروع',
    link: '/help',
    icon: 'heroQuestionMarkCircle',
    enabled: true,
  },
  {
    id: 'buyer-guide',
    label: 'راهنمای خریدار',
    link: '/buyer',
    icon: 'heroShoppingBag',
    enabled: true,
  },
  {
    id: 'seller-guide',
    label: 'راهنمای فروشنده',
    link: '/seller',
    icon: 'heroBuildingStorefront',
    enabled: true,
  },
  {
    id: 'faq',
    label: 'سوالات متداول',
    link: '/faq',
    icon: 'heroChatBubbleLeftRight',
    enabled: true,
  },
  {
    id: 'terms',
    label: 'قوانین و مقررات',
    link: '/terms',
    icon: 'heroDocumentText',
    enabled: true,
  },
  {
    id: 'privacy',
    label: 'حریم خصوصی',
    link: '/privacy',
    icon: 'heroShieldCheck',
    enabled: true,
  },
  {
    id: 'about',
    label: 'درباره ما',
    link: '/about',
    icon: 'heroBuildingOffice2',
    enabled: true,
  },
  {
    id: 'contact',
    label: 'تماس با ما',
    link: '/contact',
    icon: 'heroPhone',
    enabled: true,
  },
];

const LISTING_TYPES = new Set<string>(['DIRECT', 'EXCHANGE', 'AUCTION']);

function asListingType(raw: unknown): ListingTypeGate | '' {
  const v = String(raw ?? '')
    .trim()
    .toUpperCase();
  return LISTING_TYPES.has(v) ? (v as ListingTypeGate) : '';
}

function safePath(raw: unknown, fallback = '/'): string {
  const v = String(raw ?? '').trim();
  if (!v) return fallback;
  if (/^https?:\/\//i.test(v)) return v;
  return v.startsWith('/') ? v : `/${v.replace(/^\/+/, '')}`;
}

function safeIcon(raw: unknown, fallback: string): string {
  const v = String(raw ?? '').trim();
  if (!v) return fallback;
  if (!/^[a-zA-Z][a-zA-Z0-9_-]*$/.test(v)) return fallback;
  return v;
}

function parseJsonArray(raw: string | null | undefined): unknown[] | null {
  try {
    const parsed = JSON.parse(raw || '[]');
    return Array.isArray(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

function parseJsonObject(
  raw: string | null | undefined,
): Record<string, unknown> | null {
  try {
    const parsed = JSON.parse(raw || '{}');
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
}

export function parseHeaderNavJson(
  raw: string | null | undefined,
): HeaderNavItem[] {
  const arr = parseJsonArray(raw);
  if (!arr || arr.length === 0) return DEFAULT_HEADER_NAV.map((x) => ({ ...x }));

  const out: HeaderNavItem[] = [];
  for (const [idx, item] of arr.entries()) {
    if (!item || typeof item !== 'object') continue;
    const row = item as Record<string, unknown>;
    const label = String(row['label'] ?? '').trim();
    if (!label) continue;
    const id =
      String(row['id'] ?? '').trim() ||
      `nav-${idx + 1}-${label.slice(0, 12)}`;
    out.push({
      id,
      label,
      link: safePath(row['link'], '/listings'),
      queryType: asListingType(row['queryType']),
      enabled: row['enabled'] !== false && row['enabled'] !== 'false',
      isSpecial: row['isSpecial'] === true || row['isSpecial'] === 'true',
      isCta: row['isCta'] === true || row['isCta'] === 'true',
      requiresType: asListingType(row['requiresType']),
    });
  }
  return out.length ? out : DEFAULT_HEADER_NAV.map((x) => ({ ...x }));
}

export function parseHeaderActionsJson(
  raw: string | null | undefined,
): HeaderActionsConfig {
  const obj = parseJsonObject(raw);
  if (!obj) return { ...DEFAULT_HEADER_ACTIONS };
  return {
    cartIcon: safeIcon(obj['cartIcon'], DEFAULT_HEADER_ACTIONS.cartIcon),
    showCart: obj['showCart'] !== false && obj['showCart'] !== 'false',
    showThemeToggle:
      obj['showThemeToggle'] !== false && obj['showThemeToggle'] !== 'false',
    showCta: obj['showCta'] !== false && obj['showCta'] !== 'false',
    ctaLabel:
      String(obj['ctaLabel'] ?? '').trim() || DEFAULT_HEADER_ACTIONS.ctaLabel,
    ctaMobileLabel:
      String(obj['ctaMobileLabel'] ?? '').trim() ||
      DEFAULT_HEADER_ACTIONS.ctaMobileLabel,
    cartLabel:
      String(obj['cartLabel'] ?? '').trim() || DEFAULT_HEADER_ACTIONS.cartLabel,
    ctaLink: safePath(obj['ctaLink'], DEFAULT_HEADER_ACTIONS.ctaLink),
  };
}

export function parseFooterTextsJson(
  raw: string | null | undefined,
): FooterTextsConfig {
  const obj = parseJsonObject(raw);
  if (!obj) return { ...DEFAULT_FOOTER_TEXTS };
  return {
    clubTitle:
      String(obj['clubTitle'] ?? '').trim() || DEFAULT_FOOTER_TEXTS.clubTitle,
    clubPlaceholder:
      String(obj['clubPlaceholder'] ?? '').trim() ||
      DEFAULT_FOOTER_TEXTS.clubPlaceholder,
    clubButton:
      String(obj['clubButton'] ?? '').trim() || DEFAULT_FOOTER_TEXTS.clubButton,
    clubLoading:
      String(obj['clubLoading'] ?? '').trim() || DEFAULT_FOOTER_TEXTS.clubLoading,
    brandTitle:
      String(obj['brandTitle'] ?? '').trim() || DEFAULT_FOOTER_TEXTS.brandTitle,
    brandDot:
      String(obj['brandDot'] ?? '').trim() || DEFAULT_FOOTER_TEXTS.brandDot,
    watermark:
      String(obj['watermark'] ?? '').trim() || DEFAULT_FOOTER_TEXTS.watermark,
    quickLinksTitle:
      String(obj['quickLinksTitle'] ?? '').trim() ||
      DEFAULT_FOOTER_TEXTS.quickLinksTitle,
    trustTitle:
      String(obj['trustTitle'] ?? '').trim() || DEFAULT_FOOTER_TEXTS.trustTitle,
    popularCategoriesTitle:
      String(obj['popularCategoriesTitle'] ?? '').trim() ||
      DEFAULT_FOOTER_TEXTS.popularCategoriesTitle,
    copyright:
      String(obj['copyright'] ?? '').trim() || DEFAULT_FOOTER_TEXTS.copyright,
  };
}

export function parseFooterQuickLinksJson(
  raw: string | null | undefined,
): FooterQuickLinkItem[] {
  const arr = parseJsonArray(raw);
  if (!arr || arr.length === 0) {
    return DEFAULT_FOOTER_QUICK_LINKS.map((x) => ({ ...x }));
  }

  const out: FooterQuickLinkItem[] = [];
  for (const [idx, item] of arr.entries()) {
    if (!item || typeof item !== 'object') continue;
    const row = item as Record<string, unknown>;
    const label = String(row['label'] ?? '').trim();
    if (!label) continue;
    const id =
      String(row['id'] ?? '').trim() ||
      `flink-${idx + 1}-${label.slice(0, 12)}`;
    out.push({
      id,
      label,
      link: safePath(row['link'], '/'),
      queryType: asListingType(row['queryType']),
      icon: safeIcon(row['icon'], 'heroLink'),
      enabled: row['enabled'] !== false && row['enabled'] !== 'false',
      requiresType: asListingType(row['requiresType']),
    });
  }
  return out.length
    ? out
    : DEFAULT_FOOTER_QUICK_LINKS.map((x) => ({ ...x }));
}

