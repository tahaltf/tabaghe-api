import { ExtractJwt, Strategy } from 'passport-jwt';
import { PassportStrategy } from '@nestjs/passport';
import { Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { resolveJwtAccessSecret } from '../../config/jwt-secrets.util';
import { UserRole } from '@prisma/client';
import { AuthenticatedUser, JwtPayload } from '../../shared/contracts/auth';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';

/** بدون کش، هر درخواست احراز‌شده یک round-trip اضافه به DB دارد. Short TTL limits stale disabled/role state. */
const JWT_VALIDATE_CACHE_TTL_MS = 3_000;
const JWT_VALIDATE_CACHE_MAX = 8_000;

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy) {
  private readonly validateCache = new Map<
    string,
    { user: AuthenticatedUser; cachedAt: number }
  >();

  constructor(
    configService: ConfigService,
    private readonly prisma: PrismaService,
  ) {
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      ignoreExpiration: false,
      secretOrKey: resolveJwtAccessSecret(configService),
    });
  }

  private pruneValidateCache(now: number): void {
    if (this.validateCache.size < JWT_VALIDATE_CACHE_MAX) return;
    for (const [id, row] of this.validateCache) {
      if (now - row.cachedAt > JWT_VALIDATE_CACHE_TTL_MS) {
        this.validateCache.delete(id);
      }
    }
    if (this.validateCache.size < JWT_VALIDATE_CACHE_MAX) return;
    let removed = 0;
    for (const id of this.validateCache.keys()) {
      this.validateCache.delete(id);
      if (++removed >= 400) break;
    }
  }

  async validate(payload: JwtPayload): Promise<AuthenticatedUser> {
    const now = Date.now();
    const hit = this.validateCache.get(payload.sub);
    if (hit && now - hit.cachedAt < JWT_VALIDATE_CACHE_TTL_MS) {
      return hit.user;
    }

    const user = await this.prisma.user.findUnique({
      where: { id: payload.sub },
      select: {
        id: true,
        phone: true,
        role: true,
        status: true,
        isVerified: true,
        isActive: true,
        adminRoleId: true,
        adminRole: {
          select: {
            isActive: true,
            permissions: {
              select: { permission: { select: { key: true } } },
            },
          },
        },
      },
    });
    if (!user || !user.isActive) {
      throw new UnauthorizedException('حساب کاربری غیرفعال است');
    }

    let permissions: string[] = [];
    if (user.role === UserRole.GODADMIN) {
      permissions = ['*'];
    } else if (user.role === UserRole.ADMIN && user.adminRole?.isActive) {
      permissions = user.adminRole.permissions.map((p) => p.permission.key);
    }

    const authUser: AuthenticatedUser = {
      id: user.id,
      phone: user.phone,
      role: user.role,
      status: user.status,
      isVerified: user.isVerified,
      adminRoleId: user.adminRoleId,
      permissions,
    };
    this.validateCache.set(payload.sub, { user: authUser, cachedAt: now });
    this.pruneValidateCache(now);
    return authUser;
  }
}
