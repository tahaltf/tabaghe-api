import { BadRequestException, Injectable } from '@nestjs/common';
import { PrismaService } from '../../../infrastructure/prisma/prisma.service';
import { ServerSecretConfigService } from '../../../shared/settings/server-secret-config.service';
import { resolveUserPanelAccessMap } from '../../users/config/user-panel-access.registry';
import {
  AI_CONTENT_SETTING_KEYS,
  AI_IMAGE_EDIT_TIMEOUT_MS_MAX,
  AI_IMAGE_EDIT_TIMEOUT_MS_MIN,
  AI_IMAGE_INPUT_MAX_PX_MAX,
  AI_IMAGE_INPUT_MAX_PX_MIN,
  AI_IMAGE_SIZE_IDS,
  DEFAULT_AI_IMAGE_EDIT_TIMEOUT_MS,
  DEFAULT_AI_IMAGE_INPUT_MAX_PX,
  DEFAULT_AI_IMAGE_MODEL,
  DEFAULT_AI_IMAGE_SIZE,
  DEFAULT_AI_STORY_CONSTRAINTS,
  DEFAULT_AI_STORY_STYLES,
  DEFAULT_AI_STORY_SYSTEM_PROMPT,
  DEFAULT_AI_TEXT_MODEL,
  DEFAULT_AI_TOKEN_PACKS,
  type AiStoryStyleDef,
} from '../ai-content.constants';

@Injectable()
export class AiContentSettingsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly secrets: ServerSecretConfigService,
  ) {}

  async getString(key: string, fallback = ''): Promise<string> {
    const row = await this.prisma.systemSetting.findUnique({ where: { key } });
    const value = row?.value?.trim();
    return value || fallback;
  }

  async getInt(key: string, fallback: number): Promise<number> {
    const raw = await this.getString(key, String(fallback));
    const n = Number.parseInt(raw, 10);
    return Number.isFinite(n) ? n : fallback;
  }

  async getBool(key: string, fallback: boolean): Promise<boolean> {
    const raw = (await this.getString(key, fallback ? 'true' : 'false')).toLowerCase();
    if (['1', 'true', 'yes', 'on'].includes(raw)) return true;
    if (['0', 'false', 'no', 'off'].includes(raw)) return false;
    return fallback;
  }

  async getTokenPacks(): Promise<number[]> {
    const raw = await this.getString(
      AI_CONTENT_SETTING_KEYS.TOKEN_PACKS_JSON,
      JSON.stringify(DEFAULT_AI_TOKEN_PACKS),
    );
    try {
      const parsed = JSON.parse(raw) as unknown;
      if (!Array.isArray(parsed)) return DEFAULT_AI_TOKEN_PACKS;
      const packs = parsed
        .map((v) => Number.parseInt(String(v), 10))
        .filter((n) => Number.isFinite(n) && n > 0);
      return packs.length > 0 ? packs : DEFAULT_AI_TOKEN_PACKS;
    } catch {
      return DEFAULT_AI_TOKEN_PACKS;
    }
  }

  normalizeStyles(raw: unknown): AiStoryStyleDef[] {
    if (!Array.isArray(raw)) return [...DEFAULT_AI_STORY_STYLES];

    const styles: AiStoryStyleDef[] = [];
    for (const item of raw) {
      if (!item || typeof item !== 'object') continue;
      const row = item as Record<string, unknown>;
      const id = String(row.id ?? '')
        .trim()
        .toLowerCase()
        .replace(/[^a-z0-9_-]/g, '')
        .slice(0, 64);
      const label = String(row.label ?? '').trim().slice(0, 80);
      const promptAddon = String(row.promptAddon ?? '').trim().slice(0, 4000);
      if (!id || !label) continue;
      const sortOrderRaw = Number.parseInt(String(row.sortOrder ?? styles.length + 1), 10);
      styles.push({
        id,
        label,
        promptAddon,
        enabled: row.enabled !== false && row.enabled !== 'false',
        sortOrder: Number.isFinite(sortOrderRaw) ? sortOrderRaw : styles.length + 1,
      });
    }

    if (!styles.length) return [...DEFAULT_AI_STORY_STYLES];

    const seen = new Set<string>();
    const unique = styles.filter((s) => {
      if (seen.has(s.id)) return false;
      seen.add(s.id);
      return true;
    });

    return unique.sort((a, b) => a.sortOrder - b.sortOrder || a.label.localeCompare(b.label, 'fa'));
  }

  async getStyles(): Promise<AiStoryStyleDef[]> {
    const raw = await this.getString(
      AI_CONTENT_SETTING_KEYS.STORY_STYLES_JSON,
      JSON.stringify(DEFAULT_AI_STORY_STYLES),
    );
    try {
      return this.normalizeStyles(JSON.parse(raw) as unknown);
    } catch {
      return [...DEFAULT_AI_STORY_STYLES];
    }
  }

  async getEnabledStyles(): Promise<AiStoryStyleDef[]> {
    return (await this.getStyles()).filter((s) => s.enabled);
  }

  async getStyle(styleId: string): Promise<AiStoryStyleDef> {
    const id = String(styleId ?? '').trim();
    if (!id) {
      throw new BadRequestException('سبک تولید محتوا را انتخاب کنید');
    }
    const styles = await this.getStyles();
    const found = styles.find((s) => s.id === id && s.enabled);
    if (!found) {
      throw new BadRequestException('سبک انتخاب‌شده معتبر نیست');
    }
    return found;
  }

  async isEnabled(): Promise<boolean> {
    return this.getBool(AI_CONTENT_SETTING_KEYS.ENABLED, false);
  }

  /** Global flag + per-user panel access (contentStudio defaults to global flag). */
  async isEnabledForUser(userId: string): Promise<boolean> {
    const [aiEnabled, user] = await Promise.all([
      this.isEnabled(),
      this.prisma.user.findUnique({
        where: { id: userId },
        select: { panelAccess: true },
      }),
    ]);
    if (!user) return false;
    const access = resolveUserPanelAccessMap(user.panelAccess, {
      aiContentDefault: aiEnabled,
    });
    return access['dashboard.contentStudio'] === true;
  }

  async assertEnabledForUser(userId: string): Promise<void> {
    if (!(await this.isEnabledForUser(userId))) {
      throw new BadRequestException('تولید محتوا برای حساب شما فعال نیست');
    }
  }

  async getStoryTokenCost(): Promise<number> {
    return this.getInt(AI_CONTENT_SETTING_KEYS.STORY_TOKEN_COST, 2);
  }

  async getKycWelcomeTokens(): Promise<number> {
    return this.getInt(AI_CONTENT_SETTING_KEYS.KYC_WELCOME_TOKENS, 5);
  }

  async getTokenPriceToman(): Promise<number> {
    return this.getInt(AI_CONTENT_SETTING_KEYS.TOKEN_PRICE_TOMAN, 5000);
  }

  async getDailyLimit(): Promise<number> {
    return this.getInt(AI_CONTENT_SETTING_KEYS.DAILY_LIMIT_PER_USER, 20);
  }

  async getStorySystemPrompt(): Promise<string> {
    return this.getString(
      AI_CONTENT_SETTING_KEYS.STORY_SYSTEM_PROMPT,
      DEFAULT_AI_STORY_SYSTEM_PROMPT,
    );
  }

  async getStoryConstraints(): Promise<string> {
    return this.getString(
      AI_CONTENT_SETTING_KEYS.STORY_CONSTRAINTS,
      DEFAULT_AI_STORY_CONSTRAINTS,
    );
  }

  async getBrandLogoUrl(): Promise<string | null> {
    const url = await this.getString(AI_CONTENT_SETTING_KEYS.STORY_BRAND_LOGO_URL, '');
    return url || null;
  }

  async getTextModel(): Promise<string> {
    return this.getString(AI_CONTENT_SETTING_KEYS.TEXT_MODEL, DEFAULT_AI_TEXT_MODEL);
  }

  async getImageModel(): Promise<string> {
    return this.getString(AI_CONTENT_SETTING_KEYS.IMAGE_MODEL, DEFAULT_AI_IMAGE_MODEL);
  }

  async getImageEditTimeoutMs(): Promise<number> {
    const raw = await this.getInt(
      AI_CONTENT_SETTING_KEYS.IMAGE_EDIT_TIMEOUT_MS,
      DEFAULT_AI_IMAGE_EDIT_TIMEOUT_MS,
    );
    return Math.min(
      AI_IMAGE_EDIT_TIMEOUT_MS_MAX,
      Math.max(AI_IMAGE_EDIT_TIMEOUT_MS_MIN, raw),
    );
  }

  async getImageSize(): Promise<string> {
    const raw = await this.getString(
      AI_CONTENT_SETTING_KEYS.IMAGE_SIZE,
      DEFAULT_AI_IMAGE_SIZE,
    );
    return AI_IMAGE_SIZE_IDS.includes(raw) ? raw : DEFAULT_AI_IMAGE_SIZE;
  }

  async getImageInputMaxPx(): Promise<number> {
    const raw = await this.getInt(
      AI_CONTENT_SETTING_KEYS.IMAGE_INPUT_MAX_PX,
      DEFAULT_AI_IMAGE_INPUT_MAX_PX,
    );
    return Math.min(
      AI_IMAGE_INPUT_MAX_PX_MAX,
      Math.max(AI_IMAGE_INPUT_MAX_PX_MIN, raw),
    );
  }

  getOpenAiApiKey(): string {
    return (
      this.secrets.get('LIARA_API_KEY') ||
      this.secrets.get('AI_CONTENT_OPENAI_API_KEY') ||
      this.secrets.get('OPENAI_API_KEY') ||
      ''
    ).trim();
  }

  getOpenAiBaseUrl(): string {
    return (
      this.secrets.get('LIARA_BASE_URL') ||
      this.secrets.get('OPENAI_BASE_URL') ||
      'https://ai.liara.ir/api/v1'
    ).replace(/\/$/, '');
  }

  async getPublicConfig(userId?: string) {
    const [
      globalEnabled,
      storyTokenCost,
      tokenPriceToman,
      tokenPacks,
      kycWelcomeTokens,
      styles,
    ] = await Promise.all([
      this.isEnabled(),
      this.getStoryTokenCost(),
      this.getTokenPriceToman(),
      this.getTokenPacks(),
      this.getKycWelcomeTokens(),
      this.getEnabledStyles(),
    ]);

    const enabled = userId
      ? await this.isEnabledForUser(userId)
      : globalEnabled;

    return {
      enabled,
      globalEnabled,
      storyTokenCost,
      tokenPriceToman,
      tokenPacks,
      kycWelcomeTokens,
      styles: styles.map((s) => ({
        id: s.id,
        label: s.label,
        sortOrder: s.sortOrder,
      })),
    };
  }
}
