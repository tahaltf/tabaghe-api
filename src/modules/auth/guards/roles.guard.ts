import { Injectable, CanActivate, ExecutionContext, ForbiddenException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { UserRole } from '@prisma/client';
import { ROLES_KEY } from '../decorators/roles.decorator';

@Injectable()
export class RolesGuard implements CanActivate {
    constructor(private reflector: Reflector) {}

    canActivate(context: ExecutionContext): boolean {
        // ۱. دریافت نقش‌های مورد نیاز از دکوراتور @Roles
        const requiredRoles = this.reflector.getAllAndOverride<UserRole[]>(ROLES_KEY, [
            context.getHandler(),
            context.getClass(),
        ]);

        // اگر متد دکوراتور Roles نداشت، یعنی دسترسی برای همه لاگین شده‌ها آزاد است
        if (!requiredRoles) {
            return true;
        }

        // ۲. دریافت اطلاعات کاربر از Request (که توسط JwtAuthGuard پر شده)
        const { user } = context.switchToHttp().getRequest();

        // ۳. بررسی مطابقت نقش کاربر با نقش‌های مورد نیاز
        const hasRole = requiredRoles.some((role) => user.role === role);

        if (!hasRole) {
            throw new ForbiddenException('شما دسترسی ادمین برای انجام این عملیات را ندارید');
        }

        return true;
    }
}