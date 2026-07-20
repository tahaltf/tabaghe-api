import {
  Controller,
  Get,
  Post,
  Query,
  Req,
  Res,
  UseGuards,
} from '@nestjs/common';
import { UserRole } from '@prisma/client';
import type { Request, Response } from 'express';
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../../auth/guards/roles.guard';
import { PermissionsGuard } from '../../auth/guards/permissions.guard';
import { Roles } from '../../auth/decorators/roles.decorator';
import { RequirePermission } from '../../auth/decorators/require-permission.decorator';
import { CurrentUser } from '../../auth/decorators/current-user.decorator';
import type { AuthenticatedUser } from '../../../shared/contracts/auth';
import { InstagramOAuthService } from '../providers/instagram/instagram-oauth.service';
import { InstagramWebhookService } from '../providers/instagram/instagram-webhook.service';

@Controller('integrations/marketing/instagram/oauth')
export class MarketingInstagramOAuthController {
  constructor(private readonly oauth: InstagramOAuthService) {}

  @Get('start')
  @UseGuards(JwtAuthGuard, RolesGuard, PermissionsGuard)
  @Roles(UserRole.ADMIN)
  @RequirePermission('marketing.create')
  start(@CurrentUser() actor: AuthenticatedUser) {
    return this.oauth.startOAuth(actor.id);
  }

  @Get('callback')
  async callback(
    @Query('code') code: string | undefined,
    @Query('state') state: string | undefined,
    @Query('error') error: string | undefined,
    @Query('error_reason') errorReason: string | undefined,
    @Res() res: Response,
  ) {
    const url = await this.oauth.handleCallback(
      code,
      state,
      error || errorReason,
    );
    return res.redirect(url);
  }
}

@Controller('integrations/marketing/instagram')
export class MarketingInstagramWebhookController {
  constructor(private readonly webhook: InstagramWebhookService) {}

  @Get('webhook')
  verify(
    @Query('hub.mode') mode: string,
    @Query('hub.verify_token') token: string,
    @Query('hub.challenge') challenge: string,
    @Res() res: Response,
  ) {
    const result = this.webhook.verifyChallenge(mode, token, challenge);
    if (result) {
      return res.status(200).send(result);
    }
    return res.status(403).send('Forbidden');
  }

  @Post('webhook')
  async receive(@Req() req: Request, @Res() res: Response) {
    res.status(200).send('EVENT_RECEIVED');
    const raw = (req as Request & { rawBody?: Buffer }).rawBody;
    const sig = req.headers['x-hub-signature-256'] as string | undefined;
    if (raw && sig && !this.webhook.verifySignature(raw, sig)) {
      return;
    }
    try {
      await this.webhook.handlePayload(
        (req.body || {}) as Parameters<
          InstagramWebhookService['handlePayload']
        >[0],
      );
    } catch {
      /* swallow — Meta retries on non-2xx only; we already responded */
    }
  }
}
