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
import { PANEL_ACCESS_KEY } from '../decorators/require-panel-access.decorator';
import { UserPanelAccessService } from '../../users/user-panel-access.service';
import type { UserPanelAccessKey } from '../../users/config/user-panel-access.registry';

@Injectable()
export class UserPanelAccessGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly panelAccess: UserPanelAccessService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const required = this.reflector.getAllAndOverride<
      UserPanelAccessKey | undefined
    >(PANEL_ACCESS_KEY, [context.getHandler(), context.getClass()]);
    if (!required) return true;

    const req = context
      .switchToHttp()
      .getRequest<Request & { user?: AuthenticatedUser }>();
    const user = req.user;
    if (!user?.id) {
      throw new ForbiddenException('کاربر شناسایی نشد. لطفاً مجدد وارد شوید.');
    }

    if (user.role === UserRole.ADMIN || user.role === UserRole.GODADMIN) {
      return true;
    }

    const allowed = await this.panelAccess
      .getResolvedForUser(user.id)
      .then((map) => map[required])
      .catch(() => false);

    if (!allowed) {
      throw new ForbiddenException({
        statusCode: 403,
        error: 'عدم دسترسی',
        message: 'دسترسی شما به این بخش غیرفعال شده است.',
        code: 'PANEL_ACCESS_DENIED',
        key: required,
      });
    }

    return true;
  }
}
