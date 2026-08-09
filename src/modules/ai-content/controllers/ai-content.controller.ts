import {
  Body,
  Controller,
  Get,
  Param,
  Post,
  Query,
  Res,
  UseGuards,
} from '@nestjs/common';
import type { Response } from 'express';
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard';
import { CurrentUser } from '../../auth/decorators/current-user.decorator';
import type { AuthenticatedUser } from '../../../shared/contracts/auth';
import {
  GenerateStoryDto,
  PurchaseAiTokensDto,
  RegenerateStoryDto,
} from '../dto/ai-content.dto';
import { AiContentSettingsService } from '../services/ai-content-settings.service';
import { AiContentStoryService } from '../services/ai-content-story.service';
import { AiTokenPurchaseService } from '../services/ai-token-purchase.service';
import { AiTokenService } from '../services/ai-token.service';

@Controller('ai-content')
@UseGuards(JwtAuthGuard)
export class AiContentController {
  constructor(
    private readonly settings: AiContentSettingsService,
    private readonly tokens: AiTokenService,
    private readonly purchase: AiTokenPurchaseService,
    private readonly story: AiContentStoryService,
  ) {}

  @Get('config')
  getPublicConfig() {
    return this.settings.getPublicConfig();
  }

  @Get('tokens/balance')
  getBalance(@CurrentUser() user: AuthenticatedUser) {
    return this.tokens.getBalance(user.id);
  }

  @Post('tokens/purchase')
  purchaseTokens(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: PurchaseAiTokensDto,
  ) {
    return this.purchase.purchase(user.id, dto.packSize);
  }

  @Get('story/listings')
  listStoryListings(
    @CurrentUser() user: AuthenticatedUser,
    @Query('page') page?: string,
    @Query('limit') limit?: string,
  ) {
    return this.story.listEligibleListings(
      user.id,
      Number(page) || 1,
      Number(limit) || 20,
    );
  }

  @Post('story/generate')
  generateStory(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: GenerateStoryDto,
  ) {
    return this.story.generateStory(
      user.id,
      dto.listingId,
      dto.styleId,
      dto.userPrompt,
    );
  }

  @Post('story/:id/regenerate')
  regenerateStory(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Body() dto: RegenerateStoryDto,
  ) {
    return this.story.regenerate(user.id, id, dto.userPrompt, dto.styleId);
  }

  @Get('requests')
  listRequests(
    @CurrentUser() user: AuthenticatedUser,
    @Query('page') page?: string,
    @Query('limit') limit?: string,
  ) {
    return this.story.listRequests(
      user.id,
      Number(page) || 1,
      Number(limit) || 20,
    );
  }

  @Get('requests/:id')
  getRequest(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
  ) {
    return this.story.getRequest(user.id, id);
  }

  @Get('requests/:id/download')
  async download(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Res({ passthrough: true }) res: Response,
  ) {
    const { stream, fileName } = await this.story.downloadRequest(user.id, id);
    res.setHeader('Content-Type', 'image/png');
    res.setHeader(
      'Content-Disposition',
      `attachment; filename="${encodeURIComponent(fileName)}"`,
    );
    return stream;
  }
}
