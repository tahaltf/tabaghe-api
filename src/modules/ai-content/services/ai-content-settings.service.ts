import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../../infrastructure/prisma/prisma.service';
import { ServerSecretConfigService } from '../../../shared/settings/server-secret-config.service';
import {
  AI_CONTENT_SETTING_KEYS,
  DEFAULT_AI_STORY_CONSTRAINTS,
  DEFAULT_AI_STORY_SYSTEM_PROMPT,
  DEFAULT_AI_TOKEN_PACKS,
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

  async isEnabled(): Promise<boolean> {
    return this.getBool(AI_CONTENT_SETTING_KEYS.ENABLED, false);
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
    return this.getString(AI_CONTENT_SETTING_KEYS.TEXT_MODEL, 'gpt-4o-mini');
  }

  async getImageModel(): Promise<string> {
    return this.getString(AI_CONTENT_SETTING_KEYS.IMAGE_MODEL, 'gpt-image-1');
  }

  getOpenAiApiKey(): string {
    return (
      this.secrets.get('OPENAI_API_KEY') ||
      this.secrets.get('AI_CONTENT_OPENAI_API_KEY') ||
      ''
    ).trim();
  }

  getOpenAiBaseUrl(): string {
    return (
      this.secrets.get('OPENAI_BASE_URL') ||
      'https://api.openai.com/v1'
    ).replace(/\/$/, '');
  }

  async getPublicConfig() {
    const [enabled, storyTokenCost, tokenPriceToman, tokenPacks, kycWelcomeTokens] =
      await Promise.all([
        this.isEnabled(),
        this.getStoryTokenCost(),
        this.getTokenPriceToman(),
        this.getTokenPacks(),
        this.getKycWelcomeTokens(),
      ]);

    return {
      enabled,
      storyTokenCost,
      tokenPriceToman,
      tokenPacks,
      kycWelcomeTokens,
    };
  }
}
