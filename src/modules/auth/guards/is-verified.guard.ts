import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
  Logger,
} from '@nestjs/common';
import type { Request } from 'express';
import { UserStatus } from '@prisma/client';
import { PrismaService } from '../../../infrastructure/prisma/prisma.service';
import { AuthenticatedUser } from '../../../shared/contracts/auth';

@Injectable()
export class IsVerifiedGuard implements CanActivate {
  private readonly logger = new Logger(IsVerifiedGuard.name);

  constructor(private readonly prisma: PrismaService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const req = context
      .switchToHttp()
      .getRequest<Request & { user?: AuthenticatedUser }>();

    const authUser = req.user;
    if (!authUser?.id) {
      throw new ForbiddenException('کاربر شناسایی نشد. لطفاً مجدد وارد شوید.');
    }

    const fresh = await this.prisma.user.findUnique({
      where: { id: authUser.id },
      select: { status: true, isVerified: true },
    });

    if (!fresh || fresh.status === UserStatus.INCOMPLETE || !fresh.isVerified) {
      this.logger.debug(
        `IsVerifiedGuard denied user=${authUser.id} status=${fresh?.status} isVerified=${fresh?.isVerified}`,
      );
      throw new ForbiddenException({
        statusCode: 403,
        error: 'Forbidden',
        message:
          'حساب کاربری شما هنوز تایید نشده است. لطفاً پروفایل خود را تکمیل کنید.',
        code: 'PROFILE_INCOMPLETE',
      });
    }

    return true;
  }
}
