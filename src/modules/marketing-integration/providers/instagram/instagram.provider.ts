import {
  BadRequestException,
  Injectable,
  Logger,
  ServiceUnavailableException,
} from '@nestjs/common';
import { MarketingMediaType } from '@prisma/client';
import { ServerSecretConfigService } from '../../../../shared/settings/server-secret-config.service';
import type {
  MarketingInsightMetric,
  MarketingMediaInsight,
  MarketingOAuthResult,
  MarketingProvider,
  MarketingPublishInput,
  MarketingPublishResult,
  MarketingSendMessageResult,
} from '../marketing-provider.interface';

const GRAPH_HOST = 'https://graph.instagram.com';
const API_VERSION = 'v21.0';
const AUTH_URL = 'https://www.instagram.com/oauth/authorize';
const TOKEN_URL = 'https://api.instagram.com/oauth/access_token';

const DEFAULT_SCOPES = [
  'instagram_business_basic',
  'instagram_business_content_publish',
  'instagram_business_manage_messages',
  'instagram_business_manage_insights',
];

@Injectable()
export class InstagramProvider implements MarketingProvider {
  readonly platform = 'INSTAGRAM' as const;
  private readonly logger = new Logger(InstagramProvider.name);

  constructor(private readonly secrets: ServerSecretConfigService) {}

  /**
   * Instagram Login نیاز به Instagram App ID/Secret دارد
   * (App Dashboard → Instagram → Business login settings)،
   * نه لزوماً Facebook App ID از Settings → Basic.
   */
  private appId(): string {
    const id =
      this.secrets.get('META_INSTAGRAM_APP_ID')?.trim() ||
      this.secrets.get('META_APP_ID')?.trim();
    if (!id) {
      throw new ServiceUnavailableException(
        'META_INSTAGRAM_APP_ID (یا META_APP_ID) تنظیم نشده است.',
      );
    }
    return id;
  }

  private appSecret(): string {
    const secret =
      this.secrets.get('META_INSTAGRAM_APP_SECRET')?.trim() ||
      this.secrets.get('META_APP_SECRET')?.trim();
    if (!secret) {
      throw new ServiceUnavailableException(
        'META_INSTAGRAM_APP_SECRET (یا META_APP_SECRET) تنظیم نشده است.',
      );
    }
    return secret;
  }

  isConfigured(): boolean {
    return Boolean(this.tryAppId() && this.tryAppSecret());
  }

  private tryAppId(): string | undefined {
    return (
      this.secrets.get('META_INSTAGRAM_APP_ID')?.trim() ||
      this.secrets.get('META_APP_ID')?.trim() ||
      undefined
    );
  }

  private tryAppSecret(): string | undefined {
    return (
      this.secrets.get('META_INSTAGRAM_APP_SECRET')?.trim() ||
      this.secrets.get('META_APP_SECRET')?.trim() ||
      undefined
    );
  }

  /** آیا از Instagram App ID اختصاصی استفاده می‌شود (نه فقط Facebook App ID) */
  usesDedicatedInstagramAppCredentials(): boolean {
    return Boolean(this.secrets.get('META_INSTAGRAM_APP_ID')?.trim());
  }

  buildAuthorizeUrl(state: string, redirectUri: string): string {
    const params = new URLSearchParams({
      client_id: this.appId(),
      redirect_uri: redirectUri,
      response_type: 'code',
      scope: DEFAULT_SCOPES.join(','),
      state,
      // جلوگیری از لاگین فیسبوک شخصی که اغلب flow را به instagram.com می‌برد
      enable_fb_login: '0',
      force_reauth: 'true',
    });
    // #weblink جلوی باز شدن اپ موبایل اینستاگرام (که redirect را می‌شکند) را می‌گیرد
    return `${AUTH_URL}?${params.toString()}#weblink`;
  }

  async exchangeCode(
    code: string,
    redirectUri: string,
  ): Promise<MarketingOAuthResult> {
    const cleanCode = code.replace(/#_$/, '').trim();
    const form = new URLSearchParams({
      client_id: this.appId(),
      client_secret: this.appSecret(),
      grant_type: 'authorization_code',
      redirect_uri: redirectUri,
      code: cleanCode,
    });

    const shortRes = await fetch(TOKEN_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: form.toString(),
    });
    const shortJson = (await shortRes.json()) as {
      access_token?: string;
      user_id?: number | string;
      permissions?: string[] | string;
      error_message?: string;
      error_type?: string;
      error?: { message?: string };
      data?: Array<{
        access_token?: string;
        user_id?: number | string;
        permissions?: string[] | string;
      }>;
    };

    const tokenPayload = Array.isArray(shortJson.data)
      ? shortJson.data[0]
      : shortJson;
    const accessToken = tokenPayload?.access_token;
    const userId = tokenPayload?.user_id;
    const rawPermissions = tokenPayload?.permissions;

    if (!shortRes.ok || !accessToken) {
      this.logger.warn(`IG token exchange failed: ${JSON.stringify(shortJson)}`);
      throw new BadRequestException(
        shortJson.error_message ||
          shortJson.error?.message ||
          'خطا در دریافت توکن اینستاگرام',
      );
    }

    const longLived = await this.exchangeLongLived(accessToken);
    const profile = await this.fetchProfile(longLived.accessToken);

    const scopes = this.normalizePermissions(rawPermissions);

    return {
      externalId: String(profile.id || userId),
      username: profile.username || `user_${userId}`,
      displayName: profile.name || profile.username || null,
      profilePicture: profile.profile_picture_url || null,
      accessToken: longLived.accessToken,
      tokenExpiresAt: longLived.expiresAt,
      scopes: scopes.length ? scopes : DEFAULT_SCOPES,
    };
  }

  private normalizePermissions(
    raw: string[] | string | undefined,
  ): string[] {
    if (!raw) return [];
    if (Array.isArray(raw)) return raw.filter(Boolean);
    return raw
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);
  }

  async refreshAccessToken(accessToken: string): Promise<{
    accessToken: string;
    tokenExpiresAt?: Date | null;
  }> {
    const url = new URL(`${GRAPH_HOST}/refresh_access_token`);
    url.searchParams.set('grant_type', 'ig_refresh_token');
    url.searchParams.set('access_token', accessToken);

    const res = await fetch(url.toString());
    const json = (await res.json()) as {
      access_token?: string;
      expires_in?: number;
      error?: { message?: string };
    };
    if (!res.ok || !json.access_token) {
      throw new BadRequestException(
        json.error?.message || 'تمدید توکن اینستاگرام ناموفق بود',
      );
    }
    return {
      accessToken: json.access_token,
      tokenExpiresAt: json.expires_in
        ? new Date(Date.now() + json.expires_in * 1000)
        : null,
    };
  }

  async publish(
    accessToken: string,
    igUserId: string,
    input: MarketingPublishInput,
  ): Promise<MarketingPublishResult> {
    if (input.mediaType === MarketingMediaType.CAROUSEL) {
      return this.publishCarousel(accessToken, igUserId, input);
    }

    const containerParams: Record<string, string> = {
      access_token: accessToken,
    };
    if (input.caption) containerParams.caption = input.caption;

    if (
      input.mediaType === MarketingMediaType.STORY ||
      input.mediaType === MarketingMediaType.REEL
    ) {
      containerParams.media_type =
        input.mediaType === MarketingMediaType.STORY ? 'STORIES' : 'REELS';
      if (input.videoUrl) {
        containerParams.video_url = input.videoUrl;
      } else if (input.imageUrl) {
        containerParams.image_url = input.imageUrl;
      } else {
        throw new BadRequestException('آدرس رسانه برای انتشار لازم است');
      }
    } else if (input.videoUrl) {
      containerParams.media_type = 'REELS';
      containerParams.video_url = input.videoUrl;
    } else if (input.imageUrl) {
      containerParams.image_url = input.imageUrl;
    } else {
      throw new BadRequestException('آدرس رسانه برای انتشار لازم است');
    }

    const container = await this.graphPost<{ id: string }>(
      `/${API_VERSION}/${igUserId}/media`,
      containerParams,
    );

    await this.waitForContainer(accessToken, container.id);

    const published = await this.graphPost<{ id: string }>(
      `/${API_VERSION}/${igUserId}/media_publish`,
      {
        creation_id: container.id,
        access_token: accessToken,
      },
    );

    return {
      containerId: container.id,
      platformMediaId: published.id,
    };
  }

  private async publishCarousel(
    accessToken: string,
    igUserId: string,
    input: MarketingPublishInput,
  ): Promise<MarketingPublishResult> {
    const urls = input.childrenUrls || [];
    if (urls.length < 2) {
      throw new BadRequestException('کاروسل حداقل به ۲ رسانه نیاز دارد');
    }

    const childIds: string[] = [];
    for (const url of urls) {
      const isVideo = /\.(mp4|mov)(\?|$)/i.test(url);
      const child = await this.graphPost<{ id: string }>(
        `/${API_VERSION}/${igUserId}/media`,
        {
          access_token: accessToken,
          is_carousel_item: 'true',
          ...(isVideo
            ? { media_type: 'VIDEO', video_url: url }
            : { image_url: url }),
        },
      );
      await this.waitForContainer(accessToken, child.id);
      childIds.push(child.id);
    }

    const container = await this.graphPost<{ id: string }>(
      `/${API_VERSION}/${igUserId}/media`,
      {
        access_token: accessToken,
        media_type: 'CAROUSEL',
        children: childIds.join(','),
        ...(input.caption ? { caption: input.caption } : {}),
      },
    );

    await this.waitForContainer(accessToken, container.id);

    const published = await this.graphPost<{ id: string }>(
      `/${API_VERSION}/${igUserId}/media_publish`,
      {
        creation_id: container.id,
        access_token: accessToken,
      },
    );

    return {
      containerId: container.id,
      platformMediaId: published.id,
    };
  }

  async updateCaption(
    accessToken: string,
    mediaId: string,
    caption: string,
  ): Promise<void> {
    await this.graphPost(`/${API_VERSION}/${mediaId}`, {
      caption,
      access_token: accessToken,
    });
  }

  async getAccountInsights(
    accessToken: string,
    igUserId: string,
  ): Promise<MarketingInsightMetric[]> {
    const metrics = [
      'reach',
      'follower_count',
      'impressions',
      'profile_views',
      'website_clicks',
    ];
    try {
      const data = await this.graphGet<{
        data?: Array<{ name: string; values?: Array<{ value: number }> }>;
      }>(`/${API_VERSION}/${igUserId}/insights`, {
        metric: metrics.join(','),
        period: 'day',
        access_token: accessToken,
      });
      return (data.data || []).map((m) => ({
        metricKey: m.name,
        value: Number(m.values?.[0]?.value ?? 0),
        period: 'day',
      }));
    } catch (err) {
      this.logger.warn(
        `Insights fetch failed: ${err instanceof Error ? err.message : err}`,
      );
      // Fallback: account info as basic metrics
      const profile = await this.fetchProfile(accessToken);
      return [
        {
          metricKey: 'followers_count',
          value: Number(profile.followers_count ?? 0),
          period: 'lifetime',
        },
        {
          metricKey: 'media_count',
          value: Number(profile.media_count ?? 0),
          period: 'lifetime',
        },
      ];
    }
  }

  async getMediaInsights(
    accessToken: string,
    mediaId: string,
  ): Promise<MarketingMediaInsight> {
    try {
      const data = await this.graphGet<{
        data?: Array<{ name: string; values?: Array<{ value: number }> }>;
      }>(`/${API_VERSION}/${mediaId}/insights`, {
        metric: 'impressions,reach,likes,comments,saved,shares',
        access_token: accessToken,
      });
      return {
        mediaId,
        metrics: (data.data || []).map((m) => ({
          metricKey: m.name,
          value: Number(m.values?.[0]?.value ?? 0),
        })),
      };
    } catch {
      return { mediaId, metrics: [] };
    }
  }

  async sendDirectMessage(
    accessToken: string,
    igUserId: string,
    recipientId: string,
    text: string,
  ): Promise<MarketingSendMessageResult> {
    const res = await this.graphPost<{ message_id?: string; id?: string }>(
      `/${API_VERSION}/${igUserId}/messages`,
      {
        access_token: accessToken,
        recipient: JSON.stringify({ id: recipientId }),
        message: JSON.stringify({ text }),
      },
    );
    return {
      externalMessageId: res.message_id || res.id || `out-${Date.now()}`,
    };
  }

  private async exchangeLongLived(shortToken: string): Promise<{
    accessToken: string;
    expiresAt: Date | null;
  }> {
    const url = new URL(`${GRAPH_HOST}/access_token`);
    url.searchParams.set('grant_type', 'ig_exchange_token');
    url.searchParams.set('client_secret', this.appSecret());
    url.searchParams.set('access_token', shortToken);

    const res = await fetch(url.toString());
    const json = (await res.json()) as {
      access_token?: string;
      expires_in?: number;
      error?: { message?: string };
    };
    if (!res.ok || !json.access_token) {
      this.logger.warn(
        `Long-lived exchange failed, using short token: ${JSON.stringify(json)}`,
      );
      return { accessToken: shortToken, expiresAt: null };
    }
    return {
      accessToken: json.access_token,
      expiresAt: json.expires_in
        ? new Date(Date.now() + json.expires_in * 1000)
        : null,
    };
  }

  private async fetchProfile(accessToken: string): Promise<{
    id?: string;
    username?: string;
    name?: string;
    profile_picture_url?: string;
    followers_count?: number;
    media_count?: number;
  }> {
    return this.graphGet(`/${API_VERSION}/me`, {
      fields:
        'id,username,name,profile_picture_url,followers_count,media_count',
      access_token: accessToken,
    });
  }

  private async waitForContainer(
    accessToken: string,
    containerId: string,
    maxAttempts = 20,
  ): Promise<void> {
    for (let i = 0; i < maxAttempts; i++) {
      const status = await this.graphGet<{
        status_code?: string;
        status?: string;
      }>(`/${API_VERSION}/${containerId}`, {
        fields: 'status_code,status',
        access_token: accessToken,
      });
      const code = status.status_code || status.status;
      if (code === 'FINISHED' || code === 'PUBLISHED') return;
      if (code === 'ERROR' || code === 'EXPIRED') {
        throw new BadRequestException('پردازش رسانه اینستاگرام ناموفق بود');
      }
      await new Promise((r) => setTimeout(r, 1500));
    }
  }

  private async graphGet<T>(
    path: string,
    params: Record<string, string>,
  ): Promise<T> {
    const url = new URL(`${GRAPH_HOST}${path}`);
    for (const [k, v] of Object.entries(params)) {
      url.searchParams.set(k, v);
    }
    const res = await fetch(url.toString());
    const json = (await res.json()) as T & {
      error?: { message?: string };
    };
    if (!res.ok) {
      throw new BadRequestException(
        json.error?.message || `Instagram API error (${res.status})`,
      );
    }
    return json;
  }

  private async graphPost<T>(
    path: string,
    params: Record<string, string>,
  ): Promise<T> {
    const url = new URL(`${GRAPH_HOST}${path}`);
    const body = new URLSearchParams(params);
    const res = await fetch(url.toString(), {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: body.toString(),
    });
    const json = (await res.json()) as T & {
      error?: { message?: string };
    };
    if (!res.ok) {
      throw new BadRequestException(
        json.error?.message || `Instagram API error (${res.status})`,
      );
    }
    return json;
  }
}
