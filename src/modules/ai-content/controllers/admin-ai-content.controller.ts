import { Body, Controller, Get, Param, Put, Query, UseGuards } from '@nestjs/common';
import { UserRole } from '@prisma/client';
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../../auth/guards/roles.guard';
import { PermissionsGuard } from '../../auth/guards/permissions.guard';
import { Roles } from '../../auth/decorators/roles.decorator';
import { RequirePermission } from '../../auth/decorators/require-permission.decorator';
import { UpdateAiContentSettingsDto } from '../dto/ai-content.dto';
import { AiContentSettingsService } from '../services/ai-content-settings.service';
import { AiContentStoryService } from '../services/ai-content-story.service';
import {
  AI_CONTENT_SETTING_KEYS,
  DEFAULT_AI_STORY_STYLES,
} from '../ai-content.constants';
import { PrismaService } from '../../../infrastructure/prisma/prisma.service';

@Controller('admin/ai-content')
@UseGuards(JwtAuthGuard, RolesGuard, PermissionsGuard)
@Roles(UserRole.ADMIN)
@RequirePermission('settings.view')
export class AdminAiContentController {
  constructor(
    private readonly settings: AiContentSettingsService,
    private readonly story: AiContentStoryService,
    private readonly prisma: PrismaService,
  ) {}

  @Get('settings')
  async getSettings() {
    const [
      enabled,
      kycWelcomeTokens,
      storyTokenCost,
      tokenPriceToman,
      tokenPacks,
      storySystemPrompt,
      storyConstraints,
      storyBrandLogoUrl,
      textModel,
      imageModel,
      dailyLimitPerUser,
      styles,
    ] = await Promise.all([
      this.settings.isEnabled(),
      this.settings.getKycWelcomeTokens(),
      this.settings.getStoryTokenCost(),
      this.settings.getTokenPriceToman(),
      this.settings.getTokenPacks(),
      this.settings.getStorySystemPrompt(),
      this.settings.getStoryConstraints(),
      this.settings.getBrandLogoUrl(),
      this.settings.getTextModel(),
      this.settings.getImageModel(),
      this.settings.getDailyLimit(),
      this.settings.getStyles(),
    ]);

    return {
      enabled,
      kycWelcomeTokens,
      storyTokenCost,
      tokenPriceToman,
      tokenPacks,
      storySystemPrompt,
      storyConstraints,
      storyBrandLogoUrl,
      textModel,
      imageModel,
      dailyLimitPerUser,
      styles,
      defaultStyles: DEFAULT_AI_STORY_STYLES,
      hasOpenAiKey: Boolean(this.settings.getOpenAiApiKey()),
      openAiBaseUrl: this.settings.getOpenAiBaseUrl(),
    };
  }

  @Put('settings')
  @RequirePermission('settings.update')
  async updateSettings(@Body() dto: UpdateAiContentSettingsDto) {
    const entries: Array<{ key: string; value: string }> = [];

    if (dto.enabled !== undefined) {
      entries.push({
        key: AI_CONTENT_SETTING_KEYS.ENABLED,
        value: dto.enabled ? 'true' : 'false',
      });
    }
    if (dto.kycWelcomeTokens !== undefined) {
      entries.push({
        key: AI_CONTENT_SETTING_KEYS.KYC_WELCOME_TOKENS,
        value: String(dto.kycWelcomeTokens),
      });
    }
    if (dto.storyTokenCost !== undefined) {
      entries.push({
        key: AI_CONTENT_SETTING_KEYS.STORY_TOKEN_COST,
        value: String(dto.storyTokenCost),
      });
    }
    if (dto.tokenPriceToman !== undefined) {
      entries.push({
        key: AI_CONTENT_SETTING_KEYS.TOKEN_PRICE_TOMAN,
        value: String(dto.tokenPriceToman),
      });
    }
    if (dto.tokenPacks !== undefined) {
      entries.push({
        key: AI_CONTENT_SETTING_KEYS.TOKEN_PACKS_JSON,
        value: JSON.stringify(dto.tokenPacks),
      });
    }
    if (dto.storySystemPrompt !== undefined) {
      entries.push({
        key: AI_CONTENT_SETTING_KEYS.STORY_SYSTEM_PROMPT,
        value: dto.storySystemPrompt,
      });
    }
    if (dto.storyConstraints !== undefined) {
      entries.push({
        key: AI_CONTENT_SETTING_KEYS.STORY_CONSTRAINTS,
        value: dto.storyConstraints,
      });
    }
    if (dto.storyBrandLogoUrl !== undefined) {
      entries.push({
        key: AI_CONTENT_SETTING_KEYS.STORY_BRAND_LOGO_URL,
        value: dto.storyBrandLogoUrl,
      });
    }
    if (dto.textModel !== undefined) {
      entries.push({
        key: AI_CONTENT_SETTING_KEYS.TEXT_MODEL,
        value: dto.textModel,
      });
    }
    if (dto.imageModel !== undefined) {
      entries.push({
        key: AI_CONTENT_SETTING_KEYS.IMAGE_MODEL,
        value: dto.imageModel,
      });
    }
    if (dto.dailyLimitPerUser !== undefined) {
      entries.push({
        key: AI_CONTENT_SETTING_KEYS.DAILY_LIMIT_PER_USER,
        value: String(dto.dailyLimitPerUser),
      });
    }
    if (dto.styles !== undefined) {
      const styles = this.settings.normalizeStyles(dto.styles);
      entries.push({
        key: AI_CONTENT_SETTING_KEYS.STORY_STYLES_JSON,
        value: JSON.stringify(styles),
      });
    }

    for (const entry of entries) {
      await this.prisma.systemSetting.upsert({
        where: { key: entry.key },
        create: { key: entry.key, value: entry.value },
        update: { value: entry.value },
      });
    }

    return this.getSettings();
  }

  @Get('users/:userId/activity')
  @RequirePermission('users.view')
  listUserActivity(
    @Param('userId') userId: string,
    @Query('page') page?: string,
    @Query('limit') limit?: string,
  ) {
    return this.story.listUserActivity(
      userId,
      Number(page) || 1,
      Number(limit) || 30,
    );
  }
}
