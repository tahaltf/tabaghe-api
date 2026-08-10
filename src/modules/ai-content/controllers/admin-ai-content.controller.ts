import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Post,
  Put,
  Query,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { UserRole } from '@prisma/client';
import { existsSync, unlinkSync } from 'fs';
import { join } from 'path';
import { brandLogoMulterOptions } from '../../../common/upload/brand-logo-upload.config';
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../../auth/guards/roles.guard';
import { PermissionsGuard } from '../../auth/guards/permissions.guard';
import { Roles } from '../../auth/decorators/roles.decorator';
import { RequirePermission } from '../../auth/decorators/require-permission.decorator';
import { CurrentUser } from '../../auth/decorators/current-user.decorator';
import { AuthenticatedUser } from '../../../shared/contracts/auth';
import {
  AdminAdjustAiTokensDto,
  UpdateAiContentSettingsDto,
} from '../dto/ai-content.dto';
import { AiContentSettingsService } from '../services/ai-content-settings.service';
import { AiContentStoryService } from '../services/ai-content-story.service';
import { AiTokenService } from '../services/ai-token.service';
import {
  AI_CONTENT_SETTING_KEYS,
  AI_IMAGE_MODEL_OPTIONS,
  AI_TEXT_MODEL_OPTIONS,
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
    private readonly tokens: AiTokenService,
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
      textModelOptions: AI_TEXT_MODEL_OPTIONS,
      imageModelOptions: AI_IMAGE_MODEL_OPTIONS,
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
        value: dto.storyBrandLogoUrl?.trim() || '',
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

  @Post('brand-logo')
  @RequirePermission('settings.update')
  @UseInterceptors(FileInterceptor('file', brandLogoMulterOptions))
  async uploadBrandLogo(@UploadedFile() file?: Express.Multer.File) {
    if (!file) throw new BadRequestException('فایلی ارسال نشده است');

    const previous = await this.settings.getBrandLogoUrl();
    const publicPath = `/uploads/brand/${file.filename}`;

    await this.prisma.systemSetting.upsert({
      where: { key: AI_CONTENT_SETTING_KEYS.STORY_BRAND_LOGO_URL },
      create: {
        key: AI_CONTENT_SETTING_KEYS.STORY_BRAND_LOGO_URL,
        value: publicPath,
      },
      update: { value: publicPath },
    });

    this.tryDeleteBrandLogoFile(previous);

    return this.getSettings();
  }

  @Delete('brand-logo')
  @RequirePermission('settings.update')
  async removeBrandLogo() {
    const previous = await this.settings.getBrandLogoUrl();
    await this.prisma.systemSetting.upsert({
      where: { key: AI_CONTENT_SETTING_KEYS.STORY_BRAND_LOGO_URL },
      create: {
        key: AI_CONTENT_SETTING_KEYS.STORY_BRAND_LOGO_URL,
        value: '',
      },
      update: { value: '' },
    });
    this.tryDeleteBrandLogoFile(previous);
    return this.getSettings();
  }

  @Get('generations')
  @RequirePermission('settings.view')
  listGenerations(
    @Query('page') page?: string,
    @Query('limit') limit?: string,
    @Query('status') status?: string,
    @Query('userId') userId?: string,
    @Query('q') q?: string,
  ) {
    return this.story.listGenerations({
      page: Number(page) || 1,
      limit: Number(limit) || 20,
      status,
      userId,
      q,
    });
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

  @Get('users/:userId/tokens')
  @RequirePermission('users.view')
  async getUserTokens(@Param('userId') userId: string) {
    await this.tokens.assertUserExists(userId);
    return this.tokens.getBalance(userId);
  }

  @Post('users/:userId/tokens')
  @RequirePermission('users.update')
  async adjustUserTokens(
    @Param('userId') userId: string,
    @Body() dto: AdminAdjustAiTokensDto,
    @CurrentUser() actor: AuthenticatedUser,
  ) {
    if (!Number.isInteger(dto.amount) || dto.amount === 0) {
      throw new BadRequestException('مقدار توکن باید عدد صحیح غیرصفر باشد');
    }
    const balance = await this.tokens.adminAdjust(userId, dto.amount, {
      note: dto.note,
      adminId: actor.id,
    });
    return { balance };
  }

  private tryDeleteBrandLogoFile(stored: string | null): void {
    if (!stored) return;
    try {
      const safeName = stored.split(/[\\/]/).pop();
      if (!safeName) return;
      const fullPath = join(process.cwd(), 'uploads', 'brand', safeName);
      if (existsSync(fullPath)) unlinkSync(fullPath);
    } catch {
      // non-fatal
    }
  }
}
