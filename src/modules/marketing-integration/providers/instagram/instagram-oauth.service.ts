import { createHmac, randomBytes, timingSafeEqual } from 'crypto';
import {
  BadRequestException,
  Injectable,
  Logger,
  UnauthorizedException,
} from '@nestjs/common';
import {
  MarketingAccountStatus,
  MarketingPlatform,
} from '@prisma/client';
import { PrismaService } from '../../../../infrastructure/prisma/prisma.service';
import { ServerSecretConfigService } from '../../../../shared/settings/server-secret-config.service';
import { InstagramProvider } from './instagram.provider';
import { MarketingTokenCryptoService } from '../../services/marketing-token-crypto.service';

interface OAuthStatePayload {
  adminUserId: string;
  nonce: string;
  exp: number;
}

@Injectable()
export class InstagramOAuthService {
  private readonly logger = new Logger(InstagramOAuthService.name);

  constructor(
    private readonly secrets: ServerSecretConfigService,
    private readonly prisma: PrismaService,
    private readonly crypto: MarketingTokenCryptoService,
    private readonly instagram: InstagramProvider,
  ) {}

  getRedirectUri(): string {
    const explicit = this.secrets.get('MARKETING_OAUTH_REDIRECT_URI')?.trim();
    if (explicit) return explicit;
    const apiUrl = (
      this.secrets.get('API_PUBLIC_URL') ||
      this.secrets.get('API_URL') ||
      'http://localhost:3000'
    ).replace(/\/$/, '');
    return `${apiUrl}/api/v1/integrations/marketing/instagram/oauth/callback`;
  }

  getFrontendReturnUrl(query: Record<string, string>): string {
    const base = (
      this.secrets.get('FRONTEND_APP_URL') || 'http://localhost:4200'
    ).replace(/\/$/, '');
    const qs = new URLSearchParams(query).toString();
    return `${base}/admin/marketing/accounts?${qs}`;
  }

  startOAuth(adminUserId: string): { authorizeUrl: string } {
    if (!this.instagram.isConfigured()) {
      throw new BadRequestException(
        'Meta App هنوز پیکربندی نشده است. META_APP_ID و META_APP_SECRET را تنظیم کنید.',
      );
    }
    if (!this.crypto.isReady()) {
      throw new BadRequestException(
        'MARKETING_TOKEN_ENC_KEY تنظیم نشده است.',
      );
    }
    const state = this.signState({
      adminUserId,
      nonce: randomBytes(8).toString('hex'),
      exp: Date.now() + 15 * 60 * 1000,
    });
    const authorizeUrl = this.instagram.buildAuthorizeUrl(
      state,
      this.getRedirectUri(),
    );
    return { authorizeUrl };
  }

  async handleCallback(
    code: string | undefined,
    state: string | undefined,
    error?: string,
  ): Promise<string> {
    if (error) {
      return this.getFrontendReturnUrl({
        oauth: 'error',
        message: error,
      });
    }
    if (!code || !state) {
      return this.getFrontendReturnUrl({
        oauth: 'error',
        message: 'missing_code',
      });
    }

    let payload: OAuthStatePayload;
    try {
      payload = this.verifyState(state);
    } catch {
      return this.getFrontendReturnUrl({
        oauth: 'error',
        message: 'invalid_state',
      });
    }

    try {
      const result = await this.instagram.exchangeCode(
        code,
        this.getRedirectUri(),
      );
      const enc = this.crypto.encrypt(result.accessToken);

      const existing = await this.prisma.marketingAccount.findUnique({
        where: {
          platform_externalId: {
            platform: MarketingPlatform.INSTAGRAM,
            externalId: result.externalId,
          },
        },
        include: { token: true },
      });

      if (existing) {
        await this.prisma.$transaction([
          this.prisma.marketingAccount.update({
            where: { id: existing.id },
            data: {
              username: result.username,
              displayName: result.displayName,
              profilePicture: result.profilePicture,
              status: MarketingAccountStatus.ACTIVE,
              lastError: null,
              connectedById: payload.adminUserId,
            },
          }),
          existing.token
            ? this.prisma.marketingAccountToken.update({
                where: { accountId: existing.id },
                data: {
                  accessTokenEnc: enc,
                  tokenExpiresAt: result.tokenExpiresAt,
                  scopes: result.scopes,
                  lastRefreshedAt: new Date(),
                },
              })
            : this.prisma.marketingAccountToken.create({
                data: {
                  accountId: existing.id,
                  accessTokenEnc: enc,
                  tokenExpiresAt: result.tokenExpiresAt,
                  scopes: result.scopes,
                  lastRefreshedAt: new Date(),
                },
              }),
        ]);
      } else {
        await this.prisma.marketingAccount.create({
          data: {
            platform: MarketingPlatform.INSTAGRAM,
            externalId: result.externalId,
            username: result.username,
            displayName: result.displayName,
            profilePicture: result.profilePicture,
            status: MarketingAccountStatus.ACTIVE,
            connectedById: payload.adminUserId,
            token: {
              create: {
                accessTokenEnc: enc,
                tokenExpiresAt: result.tokenExpiresAt,
                scopes: result.scopes,
                lastRefreshedAt: new Date(),
              },
            },
          },
        });
      }

      return this.getFrontendReturnUrl({
        oauth: 'success',
        username: result.username,
      });
    } catch (err) {
      this.logger.error(
        'OAuth callback failed',
        err instanceof Error ? err.stack : undefined,
      );
      return this.getFrontendReturnUrl({
        oauth: 'error',
        message: err instanceof Error ? err.message : 'oauth_failed',
      });
    }
  }

  private signState(payload: OAuthStatePayload): string {
    const body = Buffer.from(JSON.stringify(payload)).toString('base64url');
    const sig = createHmac('sha256', this.stateSecret())
      .update(body)
      .digest('base64url');
    return `${body}.${sig}`;
  }

  private verifyState(state: string): OAuthStatePayload {
    const [body, sig] = state.split('.');
    if (!body || !sig) throw new UnauthorizedException('invalid state');
    const expected = createHmac('sha256', this.stateSecret())
      .update(body)
      .digest('base64url');
    const a = Buffer.from(sig);
    const b = Buffer.from(expected);
    if (a.length !== b.length || !timingSafeEqual(a, b)) {
      throw new UnauthorizedException('invalid state signature');
    }
    const payload = JSON.parse(
      Buffer.from(body, 'base64url').toString('utf8'),
    ) as OAuthStatePayload;
    if (!payload.adminUserId || !payload.exp || payload.exp < Date.now()) {
      throw new UnauthorizedException('state expired');
    }
    return payload;
  }

  private stateSecret(): string {
    return (
      this.secrets.get('META_APP_SECRET') ||
      process.env.JWT_SECRET?.trim() ||
      'marketing-oauth-fallback'
    );
  }
}
