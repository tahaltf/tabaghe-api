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
import { ROLES_KEY } from '../decorators/roles.decorator';

@Injectable()
export class RolesGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const requiredRoles = this.reflector.getAllAndOverride<UserRole[] | undefined>(
      ROLES_KEY,
      [context.getHandler(), context.getClass()],
    );
    if (!requiredRoles || requiredRoles.length === 0) return true;

    const req = context
      .switchToHttp()
      .getRequest<Request & { user?: AuthenticatedUser }>();

    const user = req.user;
    if (!user) {
      throw new ForbiddenException('شما دسترسی لازم برای انجام این عملیات را ندارید');
    }

    const isSuperAdmin =
      user.role === UserRole.GODADMIN &&
      requiredRoles.includes(UserRole.ADMIN);

    if (!isSuperAdmin && !requiredRoles.includes(user.role)) {
      throw new ForbiddenException('شما دسترسی لازم برای انجام این عملیات را ندارید');
    }
    return true;
  }
}
