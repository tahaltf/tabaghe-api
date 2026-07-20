import type { MarketingMediaType } from '@prisma/client';

export interface MarketingOAuthResult {
  externalId: string;
  username: string;
  displayName?: string | null;
  profilePicture?: string | null;
  accessToken: string;
  tokenExpiresAt?: Date | null;
  scopes: string[];
}

export interface MarketingPublishInput {
  mediaType: MarketingMediaType;
  caption?: string | null;
  imageUrl?: string;
  videoUrl?: string;
  /** For carousel: ordered public image/video URLs */
  childrenUrls?: string[];
}

export interface MarketingPublishResult {
  containerId?: string;
  platformMediaId: string;
}

export interface MarketingInsightMetric {
  metricKey: string;
  value: number;
  period?: string;
}

export interface MarketingMediaInsight {
  mediaId: string;
  metrics: MarketingInsightMetric[];
}

export interface MarketingSendMessageResult {
  externalMessageId: string;
}

/**
 * Contract for social network providers (Instagram first; Telegram/LinkedIn later).
 */
export interface MarketingProvider {
  readonly platform: 'INSTAGRAM';

  buildAuthorizeUrl(state: string, redirectUri: string): string;

  exchangeCode(code: string, redirectUri: string): Promise<MarketingOAuthResult>;

  refreshAccessToken(accessToken: string): Promise<{
    accessToken: string;
    tokenExpiresAt?: Date | null;
  }>;

  publish(
    accessToken: string,
    igUserId: string,
    input: MarketingPublishInput,
  ): Promise<MarketingPublishResult>;

  updateCaption?(
    accessToken: string,
    mediaId: string,
    caption: string,
  ): Promise<void>;

  getAccountInsights(
    accessToken: string,
    igUserId: string,
  ): Promise<MarketingInsightMetric[]>;

  getMediaInsights(
    accessToken: string,
    mediaId: string,
  ): Promise<MarketingMediaInsight>;

  sendDirectMessage(
    accessToken: string,
    igUserId: string,
    recipientId: string,
    text: string,
  ): Promise<MarketingSendMessageResult>;
}

export const MARKETING_PROVIDER = Symbol('MARKETING_PROVIDER');
