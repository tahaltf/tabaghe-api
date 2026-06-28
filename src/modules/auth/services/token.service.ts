import { Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import {
  resolveJwtAccessSecret,
  resolveJwtRefreshSecret,
} from '../../../config/jwt-secrets.util';
import { JwtPayload, TokenPair } from '../../../shared/contracts/auth';

const ACCESS_TOKEN_TTL = '15m';
const REFRESH_TOKEN_TTL = '30d';
const ADMIN_LOGIN_CHALLENGE_TTL = '10m';

@Injectable()
export class TokenService {
  constructor(
    private readonly jwtService: JwtService,
    private readonly configService: ConfigService,
  ) {}

  signPair(payload: JwtPayload): TokenPair {
    return {
      accessToken: this.jwtService.sign(payload, {
        secret: this.accessSecret(),
        expiresIn: ACCESS_TOKEN_TTL,
      }),
      refreshToken: this.jwtService.sign(payload, {
        secret: this.refreshSecret(),
        expiresIn: REFRESH_TOKEN_TTL,
      }),
    };
  }

  verifyRefresh(token: string): JwtPayload {
    try {
      return this.jwtService.verify<JwtPayload>(token, {
        secret: this.refreshSecret(),
      });
    } catch {
      throw new UnauthorizedException('توکن نامعتبر یا منقضی شده است.');
    }
  }

  signAdminLoginChallenge(userId: string): string {
    return this.jwtService.sign(
      { sub: userId, typ: 'admin_login_challenge' },
      {
        secret: this.accessSecret(),
        expiresIn: ADMIN_LOGIN_CHALLENGE_TTL,
      },
    );
  }

  verifyAdminLoginChallenge(token: string): string {
    try {
      const payload = this.jwtService.verify<{ sub?: string; typ?: string }>(
        token,
        { secret: this.accessSecret() },
      );
      if (payload.typ !== 'admin_login_challenge' || !payload.sub) {
        throw new UnauthorizedException('نشست ورود نامعتبر است.');
      }
      return payload.sub;
    } catch (error) {
      if (error instanceof UnauthorizedException) throw error;
      throw new UnauthorizedException(
        'نشست ورود منقضی شده است. لطفاً دوباره رمز عبور را وارد کنید.',
      );
    }
  }

  verifyAccess(token: string): JwtPayload {
    try {
      return this.jwtService.verify<JwtPayload>(token, {
        secret: this.accessSecret(),
      });
    } catch {
      throw new UnauthorizedException('توکن نامعتبر یا منقضی شده است.');
    }
  }

  accessSecret(): string {
    return resolveJwtAccessSecret(this.configService);
  }

  refreshSecret(): string {
    return resolveJwtRefreshSecret(this.configService);
  }
}
