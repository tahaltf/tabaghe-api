import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  MarketingAccountStatus,
  MarketingPlatform,
} from '@prisma/client';
import { PrismaService } from '../../../infrastructure/prisma/prisma.service';
import { ServerSecretConfigService } from '../../../shared/settings/server-secret-config.service';
import { InstagramProvider } from '../providers/instagram/instagram.provider';
import { InstagramOAuthService } from '../providers/instagram/instagram-oauth.service';
import { MarketingTokenCryptoService } from './marketing-token-crypto.service';

@Injectable()
export class MarketingAccountService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly crypto: MarketingTokenCryptoService,
    private readonly instagram: InstagramProvider,
    private readonly secrets: ServerSecretConfigService,
    private readonly oauth: InstagramOAuthService,
  ) {}

  listAccounts() {
    return this.prisma.marketingAccount.findMany({
      orderBy: { createdAt: 'desc' },
      select: {
        id: true,
        platform: true,
        externalId: true,
        username: true,
        displayName: true,
        profilePicture: true,
        status: true,
        lastError: true,
        connectedById: true,
        createdAt: true,
        updatedAt: true,
        token: {
          select: {
            tokenExpiresAt: true,
            scopes: true,
            lastRefreshedAt: true,
          },
        },
        _count: {
          select: {
            posts: true,
            conversations: true,
            mediaAssets: true,
          },
        },
      },
    });
  }

  async getAccountOrThrow(id: string) {
    const account = await this.prisma.marketingAccount.findUnique({
      where: { id },
      include: { token: true },
    });
    if (!account) {
      throw new NotFoundException('حساب مارکتینگ یافت نشد');
    }
    return account;
  }

  async disconnect(id: string) {
    await this.getAccountOrThrow(id);
    await this.prisma.marketingAccount.delete({ where: { id } });
    return { ok: true };
  }

  async getDecryptedToken(accountId: string): Promise<{
    accessToken: string;
    externalId: string;
    platform: MarketingPlatform;
  }> {
    const account = await this.getAccountOrThrow(accountId);
    if (!account.token) {
      throw new BadRequestException('توکن حساب موجود نیست؛ دوباره متصل کنید');
    }
    if (account.status === MarketingAccountStatus.REVOKED) {
      throw new BadRequestException('حساب قطع شده است');
    }
    const accessToken = this.crypto.decrypt(account.token.accessTokenEnc);
    return {
      accessToken,
      externalId: account.externalId,
      platform: account.platform,
    };
  }

  async markError(accountId: string, message: string) {
    await this.prisma.marketingAccount.update({
      where: { id: accountId },
      data: {
        status: MarketingAccountStatus.ERROR,
        lastError: message.slice(0, 500),
      },
    });
  }

  async markTokenExpired(accountId: string) {
    await this.prisma.marketingAccount.update({
      where: { id: accountId },
      data: { status: MarketingAccountStatus.TOKEN_EXPIRED },
    });
  }

  async refreshAccountToken(accountId: string) {
    const account = await this.getAccountOrThrow(accountId);
    if (!account.token) {
      throw new BadRequestException('توکن وجود ندارد');
    }
    const current = this.crypto.decrypt(account.token.accessTokenEnc);
    const refreshed = await this.instagram.refreshAccessToken(current);
    await this.prisma.marketingAccountToken.update({
      where: { accountId },
      data: {
        accessTokenEnc: this.crypto.encrypt(refreshed.accessToken),
        tokenExpiresAt: refreshed.tokenExpiresAt,
        lastRefreshedAt: new Date(),
      },
    });
    await this.prisma.marketingAccount.update({
      where: { id: accountId },
      data: {
        status: MarketingAccountStatus.ACTIVE,
        lastError: null,
      },
    });
    return { ok: true, tokenExpiresAt: refreshed.tokenExpiresAt };
  }

  getConfigStatus() {
    return {
      metaConfigured: this.instagram.isConfigured(),
      cryptoReady: this.crypto.isReady(),
      webhookVerifyConfigured: Boolean(
        this.secrets.get('META_WEBHOOK_VERIFY_TOKEN')?.trim(),
      ),
      /** باید عین همین مقدار در Meta → Business login settings → OAuth redirect URIs باشد */
      oauthRedirectUri: this.oauth.getRedirectUri(),
      frontendReturnBase: this.oauth.getFrontendReturnUrl({ oauth: 'success' }),
      usesInstagramAppId: this.instagram.usesDedicatedInstagramAppCredentials(),
    };
  }
}
