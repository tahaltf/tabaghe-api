import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Request } from 'express';
import { UserRole } from '@prisma/client';
import { AuthenticatedUser } from '../../../shared/contracts/auth';
import { PERMISSIONS_KEY } from '../decorators/require-permission.decorator';

@Injectable()
export class PermissionsGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const required = this.reflector.getAllAndOverride<string[] | undefined>(
      PERMISSIONS_KEY,
      [context.getHandler(), context.getClass()],
    );
    if (!required || required.length === 0) return true;

    const req = context
      .switchToHttp()
      .getRequest<Request & { user?: AuthenticatedUser }>();
    const user = req.user;
    if (!user) {
      throw new ForbiddenException(
        'شما دسترسی لازم برای انجام این عملیات را ندارید',
      );
    }

    if (user.role === UserRole.GODADMIN) return true;

    const perms = user.permissions ?? [];
    if (perms.includes('*')) return true;

    const ok = required.some((p) => perms.includes(p));
    if (!ok) {
      throw new ForbiddenException(
        'شما دسترسی لازم برای انجام این عملیات را ندارید',
      );
    }
    return true;
  }
}
