import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { ROLES_KEY } from '../decorators/roles.decorator';
import { UserRole } from '@prisma/client';

@Injectable()
export class RolesGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const roles = this.reflector.getAllAndOverride<string[]>(ROLES_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);

    if (!roles || roles.length === 0) return true;

    const req = context.switchToHttp().getRequest();
    const user = req.user as { role?: string } | undefined;
    if (!user?.role) return false;
    if (roles.includes(user.role)) return true;
    return user.role === UserRole.GODADMIN && roles.includes(UserRole.ADMIN);
  }
}
