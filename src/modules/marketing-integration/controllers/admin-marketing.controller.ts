import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Query,
  Res,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { UserRole } from '@prisma/client';
import type { Response } from 'express';
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../../auth/guards/roles.guard';
import { PermissionsGuard } from '../../auth/guards/permissions.guard';
import { Roles } from '../../auth/decorators/roles.decorator';
import { RequirePermission } from '../../auth/decorators/require-permission.decorator';
import { CurrentUser } from '../../auth/decorators/current-user.decorator';
import type { AuthenticatedUser } from '../../../shared/contracts/auth';
import { marketingMulterOptions } from '../../../common/upload/marketing-upload.config';
import {
  CreateMarketingPostDto,
  ReplyMarketingMessageDto,
  UpdateMarketingCaptionDto,
  UpdateMediaMetaDto,
} from '../dto/marketing.dto';
import { MarketingAccountService } from '../services/marketing-account.service';
import { MarketingMediaService } from '../services/marketing-media.service';
import { MarketingPublishService } from '../services/marketing-publish.service';
import { MarketingMessagingService } from '../services/marketing-messaging.service';
import { MarketingInsightsService } from '../services/marketing-insights.service';
import { InstagramOAuthService } from '../providers/instagram/instagram-oauth.service';

@Controller('admin/marketing')
@UseGuards(JwtAuthGuard, RolesGuard, PermissionsGuard)
@Roles(UserRole.ADMIN)
@RequirePermission('marketing.view')
export class AdminMarketingController {
  constructor(
    private readonly accounts: MarketingAccountService,
    private readonly media: MarketingMediaService,
    private readonly publish: MarketingPublishService,
    private readonly messaging: MarketingMessagingService,
    private readonly insights: MarketingInsightsService,
    private readonly oauth: InstagramOAuthService,
  ) {}

  @Get('config')
  configStatus() {
    return this.accounts.getConfigStatus();
  }

  // ── Accounts ──────────────────────────────────────────

  @Get('accounts')
  listAccounts() {
    return this.accounts.listAccounts();
  }

  @Post('accounts/connect')
  @RequirePermission('marketing.create')
  connectStart(@CurrentUser() actor: AuthenticatedUser) {
    return this.oauth.startOAuth(actor.id);
  }

  @Post('accounts/:id/refresh-token')
  @RequirePermission('marketing.update')
  refreshToken(@Param('id') id: string) {
    return this.accounts.refreshAccountToken(id);
  }

  @Delete('accounts/:id')
  @RequirePermission('marketing.delete')
  disconnect(@Param('id') id: string) {
    return this.accounts.disconnect(id);
  }

  // ── Media ─────────────────────────────────────────────

  @Get('media')
  listMedia(@Query('accountId') accountId?: string) {
    return this.media.list(accountId);
  }

  @Post('media')
  @RequirePermission('marketing.create')
  @UseInterceptors(FileInterceptor('file', marketingMulterOptions))
  uploadMedia(
    @UploadedFile() file: Express.Multer.File,
    @CurrentUser() actor: AuthenticatedUser,
    @Body() body: { accountId?: string; caption?: string; altText?: string },
  ) {
    return this.media.createFromUpload({
      file,
      createdById: actor.id,
      accountId: body.accountId,
      caption: body.caption,
      altText: body.altText,
    });
  }

  @Patch('media/:id')
  @RequirePermission('marketing.update')
  updateMedia(@Param('id') id: string, @Body() dto: UpdateMediaMetaDto) {
    return this.media.updateMeta(id, dto);
  }

  @Get('media/:id/download')
  async downloadMedia(@Param('id') id: string, @Res({ passthrough: true }) res: Response) {
    const { file, fileName } = await this.media.download(id);
    res.setHeader(
      'Content-Disposition',
      `attachment; filename="${encodeURIComponent(fileName)}"`,
    );
    return file;
  }

  @Delete('media/:id')
  @RequirePermission('marketing.delete')
  deleteMedia(@Param('id') id: string) {
    return this.media.remove(id);
  }

  // ── Posts ─────────────────────────────────────────────

  @Get('posts')
  listPosts(
    @Query('accountId') accountId?: string,
    @Query('status') status?: string,
  ) {
    return this.publish.listPosts({
      accountId,
      status: status as never,
    });
  }

  @Post('posts')
  @RequirePermission('marketing.create')
  createPost(
    @Body() dto: CreateMarketingPostDto,
    @CurrentUser() actor: AuthenticatedUser,
  ) {
    return this.publish.create({
      ...dto,
      createdById: actor.id,
    });
  }

  @Post('posts/:id/publish')
  @RequirePermission('marketing.create')
  publishNow(@Param('id') id: string) {
    return this.publish.publishPost(id);
  }

  @Patch('posts/:id/caption')
  @RequirePermission('marketing.update')
  updateCaption(
    @Param('id') id: string,
    @Body() dto: UpdateMarketingCaptionDto,
  ) {
    return this.publish.updateCaption(id, dto.caption);
  }

  @Post('posts/:id/cancel-schedule')
  @RequirePermission('marketing.update')
  cancelSchedule(@Param('id') id: string) {
    return this.publish.cancelSchedule(id);
  }

  @Delete('posts/:id')
  @RequirePermission('marketing.delete')
  deletePost(@Param('id') id: string) {
    return this.publish.remove(id);
  }

  // ── Inbox ─────────────────────────────────────────────

  @Get('inbox')
  listInbox(@Query('accountId') accountId?: string) {
    return this.messaging.listConversations(accountId);
  }

  @Get('inbox/:threadId/messages')
  getMessages(@Param('threadId') threadId: string) {
    return this.messaging.getMessages(threadId);
  }

  @Post('inbox/:threadId/reply')
  @RequirePermission('marketing.create')
  reply(
    @Param('threadId') threadId: string,
    @Body() dto: ReplyMarketingMessageDto,
    @CurrentUser() actor: AuthenticatedUser,
  ) {
    return this.messaging.reply({
      conversationId: threadId,
      text: dto.text,
      adminUserId: actor.id,
    });
  }

  // ── Analytics ─────────────────────────────────────────

  @Get('analytics/overview')
  analyticsOverview(@Query('accountId') accountId?: string) {
    return this.insights.getOverview(accountId);
  }

  @Get('analytics/media/:mediaId')
  mediaAnalytics(
    @Param('mediaId') mediaId: string,
    @Query('accountId') accountId: string,
  ) {
    return this.insights.getMediaInsights(accountId, mediaId);
  }

  @Post('analytics/refresh')
  @RequirePermission('marketing.update')
  refreshAnalytics() {
    return this.insights.refreshAllAccountInsights().then((n) => ({
      refreshedAccounts: n,
    }));
  }
}
