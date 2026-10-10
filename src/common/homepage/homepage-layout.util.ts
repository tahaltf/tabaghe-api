import type {
  HeroFloatBadge,
  HeroFloatBadgeTone,
  HomePageLayout,
  HomeSection,
  HomeSectionType,
  SliderVariant,
} from '../../shared/contracts/homepage-layout';

export const DEFAULT_HERO_FLOAT_BADGES: HeroFloatBadge[] = [
  {
    id: 'float-escrow',
    icon: 'heroShieldCheck',
    title: 'پرداخت میانجی امن',
    subtitle: 'وجه تا تأیید تحویل نزد طبقه',
    tone: 'success',
  },
  {
    id: 'float-inspect',
    icon: 'heroClipboardDocumentCheck',
    title: 'کارشناسی تخصصی',
    subtitle: 'بررسی فنی قبل از تحویل',
    tone: 'blue',
  },
];

const VALID_FLOAT_TONES = new Set<HeroFloatBadgeTone>([
  'success',
  'blue',
  'accent',
  'violet',
  'amber',
]);

const VALID_TYPES = new Set<HomeSectionType>([
  'hero',
  'trust-strip',
  'categories',
  'listings-slider',
  'locations',
  'banner',
]);

const VALID_VARIANTS = new Set<SliderVariant>([
  'carousel-cards',
  'carousel-wide',
  'compact-pills',
  'grid-2x',
  'grid-3x',
  'featured-first',
  'minimal-strip',
]);

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export const DEFAULT_HOMEPAGE_LAYOUT: HomePageLayout = {
  version: 1,
  sections: [
    {
      id: 'hero-default',
      type: 'hero',
      enabled: true,
      props: {
        badge: '',
        headline: 'همه‌چیز، در یک',
        headlineAccent: 'طبقه',
        subheadline: '',
        showSearch: true,
        showFloatingCards: true,
        useSiteBanner: true,
        visualImage: null,
        showVisual: true,
        floatBadges: structuredClone(DEFAULT_HERO_FLOAT_BADGES),
        showFloatBadges: true,
      },
    },
    {
      id: 'trust-strip-default',
      type: 'trust-strip',
      enabled: true,
      props: {
        items: [
          {
            id: 'trust-1',
            enabled: true,
            icon: 'heroShieldCheck',
            title: 'پرداخت امن میانجی',
            subtitle: 'پول تا تحویل کامل، نزد طبقه',
            badge: '۱۰۰٪',
            badgeVariant: 'stat',
          },
          {
            id: 'trust-2',
            enabled: true,
            icon: 'heroBolt',
            title: 'مزایدهٔ زنده',
            subtitle: 'شمارش معکوس و رقابت لحظه‌ای',
            badge: 'LIVE',
            badgeVariant: 'pulse',
            requiresListingType: 'AUCTION',
          },
          {
            id: 'trust-3',
            enabled: true,
            icon: 'heroArrowsRightLeft',
            title: 'معاوضهٔ شفاف',
            subtitle: 'قرارداد دوطرفه + کارشناسی',
            badge: '۲ طرفه',
            badgeVariant: 'blue',
            requiresListingType: 'EXCHANGE',
          },
          {
            id: 'trust-4',
            enabled: true,
            icon: 'heroWrenchScrewdriver',
            title: 'تعمیر تخصصی',
            subtitle: 'پیگیری مرحله‌به‌مرحله + گارانتی',
            badge: '۲۴/۷',
            badgeVariant: 'violet',
          },
        ],
      },
    },
    {
      id: 'categories-default',
      type: 'categories',
      enabled: true,
      props: {
        variant: 'compact-pills',
        mode: 'auto',
        maxItems: 24,
      },
    },
    {
      id: 'slider-accessory',
      type: 'listings-slider',
      enabled: true,
      style: { accentColor: 'amber' },
      props: {
        variant: 'carousel-cards',
        feed: 'category',
        categorySlug: 'accessory',
        limit: 10,
        eyebrow: 'انتخاب ویژه',
        title: 'زیورآلات',
        titleAccent: 'و اکسسوری',
        subtitle: 'جواهرات، بدلیجات و اکسسوری‌های منتخب',
        showViewAll: true,
        viewAllLink: '/category/accessory',
        theme: 'amber',
      },
    },
    {
      id: 'locations-default',
      type: 'locations',
      enabled: true,
      props: {
        eyebrow: 'آگهی بر اساس موقعیت',
        title: 'آگهی‌های',
        titleAccent: 'بر اساس استان',
        subtitle: '',
      },
    },
    {
      id: 'slider-direct',
      type: 'listings-slider',
      enabled: true,
      props: {
        variant: 'carousel-cards',
        feed: 'direct',
        limit: 10,
        title: 'ویترین',
        titleAccent: 'فروش',
        subtitle: 'کالاهای آماده ارسال با قیمت مقطوع',
        showViewAll: true,
        viewAllLink: '/listings?type=DIRECT',
        theme: 'accent',
      },
    },
    {
      id: 'slider-auction',
      type: 'listings-slider',
      enabled: true,
      props: {
        variant: 'carousel-cards',
        feed: 'auction',
        limit: 10,
        title: 'تالار',
        titleAccent: 'مزایده',
        subtitle: '',
        showViewAll: true,
        viewAllLink: '/listings?type=AUCTION',
        theme: 'accent',
      },
    },
    {
      id: 'slider-exchange',
      type: 'listings-slider',
      enabled: true,
      props: {
        variant: 'carousel-cards',
        feed: 'exchange',
        limit: 10,
        title: 'فرصت‌های',
        titleAccent: 'معاوضه',
        subtitle: 'کالای خودت رو با چیزی که نیاز داری عوض کن',
        showViewAll: true,
        viewAllLink: '/listings?type=EXCHANGE',
        theme: 'blue',
      },
    },
  ],
};

function asString(v: unknown, fallback = ''): string {
  return typeof v === 'string' ? v : fallback;
}

function asBool(v: unknown, fallback: boolean): boolean {
  return typeof v === 'boolean' ? v : fallback;
}

function coerceFloatBadges(raw: unknown, fallback: HeroFloatBadge[]): HeroFloatBadge[] {
  if (!Array.isArray(raw) || !raw.length) return structuredClone(fallback);
  const out: HeroFloatBadge[] = [];
  for (let i = 0; i < Math.min(raw.length, 2); i++) {
    const item = raw[i];
    if (!item || typeof item !== 'object') continue;
    const r = item as Record<string, unknown>;
    const def = fallback[i] ?? fallback[0];
    const toneRaw = asString(r['tone'], def?.tone ?? 'success') as HeroFloatBadgeTone;
    out.push({
      id: asString(r['id'], def?.id ?? `float-${i}`),
      icon: asString(r['icon'], def?.icon ?? 'heroShieldCheck'),
      title: asString(r['title'], def?.title ?? ''),
      subtitle: asString(r['subtitle'], def?.subtitle ?? ''),
      tone: VALID_FLOAT_TONES.has(toneRaw) ? toneRaw : (def?.tone ?? 'success'),
    });
  }
  return out.length ? out : structuredClone(fallback);
}

function asNumber(v: unknown, fallback: number): number {
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
}

function pickVariant(v: unknown, fallback: SliderVariant): SliderVariant {
  const s = asString(v, fallback);
  return VALID_VARIANTS.has(s as SliderVariant) ? (s as SliderVariant) : fallback;
}

function coerceSection(raw: unknown, index: number): HomeSection | null {
  if (!raw || typeof raw !== 'object') return null;
  const row = raw as Record<string, unknown>;
  const type = asString(row['type']).trim() as HomeSectionType;
  if (!VALID_TYPES.has(type)) return null;

  const id = asString(row['id'], `${type}-${index}`);
  const enabled = asBool(row['enabled'], true);
  const style =
    row['style'] && typeof row['style'] === 'object'
      ? (row['style'] as HomeSection['style'])
      : undefined;
  const props = (row['props'] && typeof row['props'] === 'object'
    ? row['props']
    : {}) as Record<string, unknown>;

  switch (type) {
    case 'hero': {
      const defHero = DEFAULT_HOMEPAGE_LAYOUT.sections.find((s) => s.type === 'hero');
      const defProps =
        defHero && defHero.type === 'hero'
          ? defHero.props
          : {
              headline: 'همه‌چیز، در یک',
              showSearch: true,
              showFloatingCards: true,
              useSiteBanner: true,
              showVisual: true,
              showFloatBadges: true,
              floatBadges: DEFAULT_HERO_FLOAT_BADGES,
            };
      const showFloatingCards = asBool(props['showFloatingCards'], defProps.showFloatingCards ?? true);
      const showFloatBadges =
        typeof props['showFloatBadges'] === 'boolean'
          ? props['showFloatBadges']
          : showFloatingCards;
      return {
        id,
        type,
        enabled,
        style,
        props: {
          badge: asString(props['badge']),
          headline: asString(props['headline'], defProps.headline),
          headlineAccent: asString(props['headlineAccent'], 'طبقه'),
          subheadline: asString(props['subheadline']),
          showSearch: asBool(props['showSearch'], true),
          showFloatingCards,
          useSiteBanner: asBool(props['useSiteBanner'], true),
          visualImage: asString(props['visualImage']) || null,
          showVisual: asBool(props['showVisual'], defProps.showVisual ?? true),
          floatBadges: coerceFloatBadges(
            props['floatBadges'],
            defProps.floatBadges ?? DEFAULT_HERO_FLOAT_BADGES,
          ),
          showFloatBadges,
        },
      };
    }
    case 'trust-strip': {
      const itemsRaw = Array.isArray(props['items']) ? props['items'] : [];
      const defaultItems =
        (DEFAULT_HOMEPAGE_LAYOUT.sections.find((s) => s.type === 'trust-strip') as Extract<
          HomeSection,
          { type: 'trust-strip' }
        >)?.props.items ?? [];
      const items = itemsRaw.length
        ? itemsRaw
            .map((item, i) => {
              if (!item || typeof item !== 'object') return null;
              const r = item as Record<string, unknown>;
              return {
                id: asString(r['id'], `trust-${i}`),
                enabled: asBool(r['enabled'], true),
                icon: asString(r['icon'], 'heroCube'),
                title: asString(r['title']),
                subtitle: asString(r['subtitle']),
                badge: asString(r['badge']) || undefined,
                badgeVariant: (asString(r['badgeVariant'], 'stat') ||
                  'stat') as 'stat' | 'pulse' | 'blue' | 'violet' | 'amber',
                requiresListingType:
                  r['requiresListingType'] === 'AUCTION' ||
                  r['requiresListingType'] === 'EXCHANGE'
                    ? (r['requiresListingType'] as 'AUCTION' | 'EXCHANGE')
                    : null,
              };
            })
            .filter(Boolean)
        : defaultItems;
      return { id, type, enabled, style, props: { items: items as NonNullable<typeof items> } };
    }
    case 'categories':
      return {
        id,
        type,
        enabled,
        style,
        props: {
          variant: pickVariant(props['variant'], 'compact-pills'),
          mode: props['mode'] === 'manual' ? 'manual' : 'auto',
          categoryIds: Array.isArray(props['categoryIds'])
            ? props['categoryIds']
                .map((x) => asString(x))
                .filter((x) => UUID_RE.test(x))
            : undefined,
          maxItems: Math.min(48, Math.max(1, asNumber(props['maxItems'], 24))),
          eyebrow: asString(props['eyebrow']) || undefined,
          title: asString(props['title']) || undefined,
          subtitle: asString(props['subtitle']) || undefined,
        },
      };
    case 'listings-slider': {
      const feedRaw = asString(props['feed'], 'direct');
      const feed =
        feedRaw === 'auction' ||
        feedRaw === 'exchange' ||
        feedRaw === 'category' ||
        feedRaw === 'direct'
          ? feedRaw
          : 'direct';
      const defSlider = DEFAULT_HOMEPAGE_LAYOUT.sections.find(
        (s): s is Extract<HomeSection, { type: 'listings-slider' }> =>
          s.id === id && s.type === 'listings-slider',
      ) ?? DEFAULT_HOMEPAGE_LAYOUT.sections.find(
        (s): s is Extract<HomeSection, { type: 'listings-slider' }> =>
          s.type === 'listings-slider' && s.props.feed === feed,
      );
      const defProps = defSlider?.props;
      const categorySlug =
        asString(props['categorySlug']).trim() ||
        asString(defProps?.categorySlug).trim() ||
        undefined;
      if (feed === 'category' && !categorySlug) return null;
      return {
        id,
        type,
        enabled,
        style: style ?? defSlider?.style,
        props: {
          variant: pickVariant(props['variant'], defProps?.variant ?? 'carousel-cards'),
          feed,
          categorySlug,
          limit: Math.min(30, Math.max(1, asNumber(props['limit'], defProps?.limit ?? 10))),
          eyebrow:
            asString(props['eyebrow']).trim() || asString(defProps?.eyebrow).trim() || undefined,
          title: asString(props['title'], defProps?.title ?? ''),
          titleAccent:
            asString(props['titleAccent']).trim() ||
            asString(defProps?.titleAccent).trim() ||
            undefined,
          subtitle:
            asString(props['subtitle']).trim() || asString(defProps?.subtitle).trim() || undefined,
          showViewAll: asBool(props['showViewAll'], defProps?.showViewAll ?? true),
          viewAllLink:
            feed === 'category' && categorySlug
              ? `/category/${categorySlug}`
              : asString(props['viewAllLink']).trim() ||
                asString(defProps?.viewAllLink).trim() ||
                undefined,
          theme: (asString(props['theme'], defProps?.theme ?? 'accent') || 'accent') as HomeSection extends {
            type: 'listings-slider';
          }
            ? HomeSection['props']['theme']
            : 'accent',
        },
      };
    }
    case 'locations': {
      const def = DEFAULT_HOMEPAGE_LAYOUT.sections.find(
        (s): s is Extract<HomeSection, { type: 'locations' }> =>
          s.id === id && s.type === 'locations',
      ) ?? DEFAULT_HOMEPAGE_LAYOUT.sections.find(
        (s): s is Extract<HomeSection, { type: 'locations' }> => s.type === 'locations',
      );
      const defProps = def?.props;
      return {
        id,
        type,
        enabled,
        style,
        props: {
          eyebrow:
            asString(props['eyebrow']).trim() || asString(defProps?.eyebrow).trim() || undefined,
          title: asString(props['title']).trim() || asString(defProps?.title).trim() || undefined,
          titleAccent:
            asString(props['titleAccent']).trim() ||
            asString(defProps?.titleAccent).trim() ||
            undefined,
          subtitle:
            asString(props['subtitle']).trim() || asString(defProps?.subtitle).trim() || undefined,
        },
      };
    }
    case 'banner':
      return {
        id,
        type,
        enabled,
        style,
        props: {
          headline: asString(props['headline']),
          subheadline: asString(props['subheadline']) || undefined,
          ctaLabel: asString(props['ctaLabel']) || undefined,
          ctaLink: asString(props['ctaLink']) || undefined,
          useSiteBanner: asBool(props['useSiteBanner'], true),
          imageUrl: asString(props['imageUrl']) || null,
        },
      };
    default:
      return null;
  }
}

export function parseHomepageLayoutRaw(raw: unknown): HomePageLayout | null {
  if (raw == null) return null;
  let parsed: unknown = raw;
  if (typeof raw === 'string') {
    const trimmed = raw.trim();
    if (!trimmed) return null;
    try {
      parsed = JSON.parse(trimmed);
    } catch {
      return null;
    }
  }
  if (!parsed || typeof parsed !== 'object') return null;
  const row = parsed as Record<string, unknown>;
  const sectionsRaw = Array.isArray(row['sections']) ? row['sections'] : [];
  const sections = sectionsRaw
    .map((s, i) => coerceSection(s, i))
    .filter((s): s is HomeSection => !!s)
    .slice(0, 20);
  if (!sections.length) return null;
  return { version: 1, sections };
}

export function mergeHomepageLayout(stored: unknown): HomePageLayout {
  const parsed = parseHomepageLayoutRaw(stored);
  return parsed ?? structuredClone(DEFAULT_HOMEPAGE_LAYOUT);
}

export function validateHomepageLayout(layout: HomePageLayout): string | null {
  if (!layout?.sections?.length) return 'حداقل یک بخش لازم است';
  if (layout.sections.length > 20) return 'حداکثر ۲۰ بخش مجاز است';
  for (const section of layout.sections) {
    if (section.type === 'listings-slider' && section.props.feed === 'category') {
      if (!section.props.categorySlug?.trim()) {
        return `اسلایدر ${section.id}: اسلاگ دسته الزامی است`;
      }
    }
    if (section.type === 'categories' && section.props.mode === 'manual') {
      if (!section.props.categoryIds?.length) {
        return `بخش دسته‌ها ${section.id}: حداقل یک دسته انتخاب کنید`;
      }
    }
  }
  return null;
}
