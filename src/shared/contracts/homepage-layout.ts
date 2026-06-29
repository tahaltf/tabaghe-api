export type HomeSectionType =
  | 'hero'
  | 'trust-strip'
  | 'categories'
  | 'listings-slider'
  | 'locations'
  | 'banner';

export type SliderVariant =
  | 'carousel-cards'
  | 'carousel-wide'
  | 'compact-pills'
  | 'grid-2x'
  | 'grid-3x'
  | 'featured-first'
  | 'minimal-strip';

export type HomeAccentToken =
  | 'accent'
  | 'amber'
  | 'emerald'
  | 'blue'
  | 'indigo'
  | 'violet'
  | 'rose';

export interface HomeSectionStyle {
  accentColor?: HomeAccentToken | string;
  background?: 'default' | 'muted' | 'gradient' | 'custom';
  backgroundColor?: string;
  textAlign?: 'right' | 'center';
}

export interface HomeSectionBase {
  id: string;
  type: HomeSectionType;
  enabled: boolean;
  style?: HomeSectionStyle;
}

export interface TrustStripItem {
  id: string;
  enabled: boolean;
  icon: string;
  title: string;
  subtitle: string;
  badge?: string;
  badgeVariant?: 'stat' | 'pulse' | 'blue' | 'violet' | 'amber';
  requiresListingType?: 'AUCTION' | 'EXCHANGE' | null;
}

export interface HomePageLayout {
  version: 1;
  sections: HomeSection[];
}

export type HomeSection =
  | (HomeSectionBase & {
      type: 'hero';
      props: {
        badge?: string;
        headline: string;
        headlineAccent?: string;
        subheadline?: string;
        showSearch: boolean;
        showFloatingCards: boolean;
        useSiteBanner?: boolean;
      };
    })
  | (HomeSectionBase & {
      type: 'trust-strip';
      props: { items: TrustStripItem[] };
    })
  | (HomeSectionBase & {
      type: 'categories';
      props: {
        variant: SliderVariant;
        mode: 'auto' | 'manual';
        categoryIds?: string[];
        maxItems?: number;
        eyebrow?: string;
        title?: string;
        subtitle?: string;
      };
    })
  | (HomeSectionBase & {
      type: 'listings-slider';
      props: {
        variant: SliderVariant;
        feed: 'direct' | 'auction' | 'exchange' | 'category';
        categorySlug?: string;
        limit?: number;
        eyebrow?: string;
        title?: string;
        titleAccent?: string;
        subtitle?: string;
        showViewAll: boolean;
        viewAllLink?: string;
        theme?: HomeAccentToken;
      };
    })
  | (HomeSectionBase & {
      type: 'locations';
      props: {
        eyebrow?: string;
        title?: string;
        titleAccent?: string;
        subtitle?: string;
      };
    })
  | (HomeSectionBase & {
      type: 'banner';
      props: {
        headline: string;
        subheadline?: string;
        ctaLabel?: string;
        ctaLink?: string;
        useSiteBanner?: boolean;
        imageUrl?: string | null;
      };
    });
