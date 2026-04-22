import { Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import {
  JwtPayload,
  TokenPair,
} from '../../../shared/contracts/auth';

const ACCESS_TOKEN_TTL = '7d';
const REFRESH_TOKEN_TTL = '30d';

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
    return (
      this.configService.get<string>('JWT_SECRET') ?? 'fallback_access_secret_key'
    );
  }

  refreshSecret(): string {
    return (
      this.configService.get<string>('JWT_REFRESH_SECRET') ??
      'fallback_refresh_secret_key'
    );
  }
}
