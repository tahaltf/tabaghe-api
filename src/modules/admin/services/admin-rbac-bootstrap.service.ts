import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { UserRole } from '@prisma/client';
import { PrismaService } from '../../../infrastructure/prisma/prisma.service';
import {
  ADMIN_PERMISSION_CATALOG,
  DEFAULT_ADMIN_ROLES,
  FULL_OPS_ROLE_SLUG,
} from '../config/admin-permissions.registry';

@Injectable()
export class AdminRbacBootstrapService implements OnModuleInit {
  private readonly logger = new Logger(AdminRbacBootstrapService.name);

  constructor(private readonly prisma: PrismaService) {}

  async onModuleInit(): Promise<void> {
    await this.syncPermissions();
    const fullOpsId = await this.ensureDefaultRoles();
    await this.assignFullOpsToAdminsWithoutRole(fullOpsId);
  }

  private async syncPermissions(): Promise<void> {
    for (const def of ADMIN_PERMISSION_CATALOG) {
      await this.prisma.adminPermission.upsert({
        where: { key: def.key },
        create: {
          key: def.key,
          group: def.group,
          groupLabel: def.groupLabel,
          action: def.action,
          label: def.label,
          description: def.description ?? null,
          sortOrder: def.sortOrder,
        },
        update: {
          group: def.group,
          groupLabel: def.groupLabel,
          action: def.action,
          label: def.label,
          description: def.description ?? null,
          sortOrder: def.sortOrder,
        },
      });
    }
    this.logger.log(
      `Synced ${ADMIN_PERMISSION_CATALOG.length} admin permissions.`,
    );
  }

  /** ساخت/سینک نقش‌های سیستمی پیش‌فرض و برگرداندن id نقش ادمین کل */
  private async ensureDefaultRoles(): Promise<string> {
    const allPerms = await this.prisma.adminPermission.findMany({
      select: { id: true, key: true },
    });
    const byKey = new Map(allPerms.map((p) => [p.key, p.id]));
    const catalogKeys = new Set(ADMIN_PERMISSION_CATALOG.map((p) => p.key));

    let fullOpsId = '';

    for (const def of DEFAULT_ADMIN_ROLES) {
      const role = await this.prisma.adminRole.upsert({
        where: { slug: def.slug },
        create: {
          name: def.name,
          slug: def.slug,
          description: def.description,
          isSystem: true,
          isActive: true,
        },
        update: {
          name: def.name,
          description: def.description,
          isSystem: true,
          isActive: true,
        },
        select: { id: true },
      });

      const keys =
        def.permissionKeys === null
          ? [...catalogKeys]
          : def.permissionKeys.filter((k) => catalogKeys.has(k));

      const permissionIds = keys
        .map((k) => byKey.get(k))
        .filter((id): id is string => !!id);

      await this.prisma.adminRolePermission.deleteMany({
        where: { roleId: role.id },
      });
      if (permissionIds.length) {
        await this.prisma.adminRolePermission.createMany({
          data: permissionIds.map((permissionId) => ({
            roleId: role.id,
            permissionId,
          })),
          skipDuplicates: true,
        });
      }

      if (def.slug === FULL_OPS_ROLE_SLUG) {
        fullOpsId = role.id;
      }

      this.logger.log(
        `Ensured system role "${def.name}" (${def.slug}) with ${permissionIds.length} permissions.`,
      );
    }

    if (!fullOpsId) {
      throw new Error('Default full-ops admin role was not created');
    }
    return fullOpsId;
  }

  private async assignFullOpsToAdminsWithoutRole(
    fullOpsRoleId: string,
  ): Promise<void> {
    const result = await this.prisma.user.updateMany({
      where: {
        role: UserRole.ADMIN,
        adminRoleId: null,
      },
      data: { adminRoleId: fullOpsRoleId },
    });
    if (result.count > 0) {
      this.logger.log(
        `Assigned full-ops role to ${result.count} ADMIN user(s).`,
      );
    }
  }
}
