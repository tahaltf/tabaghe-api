import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { UserRole } from '@prisma/client';
import { PrismaService } from '../../../infrastructure/prisma/prisma.service';
import { AuthenticatedUser } from '../../../shared/contracts/auth';
import {
  ADMIN_PERMISSION_CATALOG,
  ADMIN_ROUTE_PERMISSIONS,
  FULL_OPS_ROLE_SLUG,
  isGodAdminRole,
} from '../config/admin-permissions.registry';
import { CreateAdminRoleDto } from '../dto/admin-role.dto';
import { UpdateAdminRoleDto } from '../dto/admin-role.dto';

@Injectable()
export class AdminRolesService {
  constructor(private readonly prisma: PrismaService) {}

  async getMyAccess(user: AuthenticatedUser) {
    if (isGodAdminRole(user.role)) {
      return {
        role: user.role,
        adminRoleId: null,
        adminRole: null,
        permissions: ['*'] as string[],
        isGodAdmin: true,
        routeViewPermission: ADMIN_ROUTE_PERMISSIONS.routeViewPermission,
        godadminOnlyRoutes: ADMIN_ROUTE_PERMISSIONS.godadminOnly,
      };
    }

    const permissions = user.permissions ?? [];
    let adminRole: { id: string; name: string; slug: string } | null = null;
    if (user.adminRoleId) {
      adminRole = await this.prisma.adminRole.findUnique({
        where: { id: user.adminRoleId },
        select: { id: true, name: true, slug: true },
      });
    }

    return {
      role: user.role,
      adminRoleId: user.adminRoleId ?? null,
      adminRole,
      permissions,
      isGodAdmin: false,
      routeViewPermission: ADMIN_ROUTE_PERMISSIONS.routeViewPermission,
      godadminOnlyRoutes: ADMIN_ROUTE_PERMISSIONS.godadminOnly,
    };
  }

  catalog() {
    const groups = new Map<
      string,
      {
        group: string;
        groupLabel: string;
        permissions: Array<{
          key: string;
          action: string;
          label: string;
          description?: string;
        }>;
      }
    >();

    for (const p of ADMIN_PERMISSION_CATALOG) {
      let g = groups.get(p.group);
      if (!g) {
        g = { group: p.group, groupLabel: p.groupLabel, permissions: [] };
        groups.set(p.group, g);
      }
      g.permissions.push({
        key: p.key,
        action: p.action,
        label: p.label,
        description: p.description,
      });
    }

    return {
      groups: [...groups.values()],
      keys: ADMIN_PERMISSION_CATALOG.map((p) => p.key),
    };
  }

  async listRoles() {
    const roles = await this.prisma.adminRole.findMany({
      orderBy: [{ isSystem: 'desc' }, { name: 'asc' }],
      include: {
        permissions: {
          include: { permission: { select: { key: true, label: true, group: true } } },
        },
        _count: { select: { users: true } },
      },
    });

    return roles.map((r) => ({
      id: r.id,
      name: r.name,
      slug: r.slug,
      description: r.description,
      isSystem: r.isSystem,
      isActive: r.isActive,
      userCount: r._count.users,
      permissionKeys: r.permissions.map((p) => p.permission.key),
      createdAt: r.createdAt,
      updatedAt: r.updatedAt,
    }));
  }

  async getRole(id: string) {
    const role = await this.prisma.adminRole.findUnique({
      where: { id },
      include: {
        permissions: {
          include: { permission: true },
        },
        _count: { select: { users: true } },
      },
    });
    if (!role) throw new NotFoundException('نقش یافت نشد');
    return {
      id: role.id,
      name: role.name,
      slug: role.slug,
      description: role.description,
      isSystem: role.isSystem,
      isActive: role.isActive,
      userCount: role._count.users,
      permissionKeys: role.permissions.map((p) => p.permission.key),
      createdAt: role.createdAt,
      updatedAt: role.updatedAt,
    };
  }

  async createRole(dto: CreateAdminRoleDto) {
    const slug = this.normalizeSlug(dto.slug || dto.name);
    await this.assertSlugAvailable(slug);
    this.assertValidPermissionKeys(dto.permissionKeys);

    const perms = await this.prisma.adminPermission.findMany({
      where: { key: { in: dto.permissionKeys } },
      select: { id: true },
    });

    const role = await this.prisma.adminRole.create({
      data: {
        name: dto.name.trim(),
        slug,
        description: dto.description?.trim() || null,
        isSystem: false,
        isActive: dto.isActive ?? true,
        permissions: {
          create: perms.map((p) => ({ permissionId: p.id })),
        },
      },
      select: { id: true },
    });
    return this.getRole(role.id);
  }

  async updateRole(id: string, dto: UpdateAdminRoleDto) {
    const existing = await this.prisma.adminRole.findUnique({
      where: { id },
      select: { id: true, slug: true, isSystem: true },
    });
    if (!existing) throw new NotFoundException('نقش یافت نشد');

    if (dto.slug && dto.slug !== existing.slug) {
      if (existing.isSystem) {
        throw new BadRequestException('اسلاگ نقش سیستمی قابل تغییر نیست');
      }
      const slug = this.normalizeSlug(dto.slug);
      await this.assertSlugAvailable(slug, id);
    }

    if (dto.permissionKeys) {
      this.assertValidPermissionKeys(dto.permissionKeys);
    }

    const data: {
      name?: string;
      slug?: string;
      description?: string | null;
      isActive?: boolean;
    } = {};
    if (dto.name !== undefined) data.name = dto.name.trim();
    if (dto.slug !== undefined && !existing.isSystem) {
      data.slug = this.normalizeSlug(dto.slug);
    }
    if (dto.description !== undefined) {
      data.description = dto.description?.trim() || null;
    }
    if (dto.isActive !== undefined) {
      if (existing.isSystem && dto.isActive === false) {
        throw new BadRequestException('نقش سیستمی را نمی‌توان غیرفعال کرد');
      }
      data.isActive = dto.isActive;
    }

    await this.prisma.$transaction(async (tx) => {
      await tx.adminRole.update({ where: { id }, data });
      if (dto.permissionKeys) {
        const perms = await tx.adminPermission.findMany({
          where: { key: { in: dto.permissionKeys } },
          select: { id: true },
        });
        await tx.adminRolePermission.deleteMany({ where: { roleId: id } });
        if (perms.length) {
          await tx.adminRolePermission.createMany({
            data: perms.map((p) => ({ roleId: id, permissionId: p.id })),
          });
        }
      }
    });

    return this.getRole(id);
  }

  async deleteRole(id: string) {
    const role = await this.prisma.adminRole.findUnique({
      where: { id },
      select: { id: true, isSystem: true, slug: true, _count: { select: { users: true } } },
    });
    if (!role) throw new NotFoundException('نقش یافت نشد');
    if (role.isSystem || role.slug === FULL_OPS_ROLE_SLUG) {
      throw new BadRequestException('نقش سیستمی قابل حذف نیست');
    }
    if (role._count.users > 0) {
      throw new BadRequestException(
        'این نقش به کاربرانی اختصاص داده شده؛ ابتدا نقش آن‌ها را تغییر دهید',
      );
    }
    await this.prisma.adminRole.delete({ where: { id } });
    return { ok: true };
  }

  async setUserAdminRole(
    actor: AuthenticatedUser,
    userId: string,
    adminRoleId: string | null,
  ) {
    if (actor.role !== UserRole.GODADMIN) {
      throw new ForbiddenException('فقط گاد ادمین می‌تواند نقش ادمین را تغییر دهد');
    }
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { id: true, role: true },
    });
    if (!user) throw new NotFoundException('کاربر یافت نشد');
    if (user.role !== UserRole.ADMIN) {
      throw new BadRequestException(
        'فقط کاربران با نقش ADMIN می‌توانند نقش سفارشی داشته باشند',
      );
    }
    if (adminRoleId) {
      const role = await this.prisma.adminRole.findUnique({
        where: { id: adminRoleId },
        select: { id: true, isActive: true },
      });
      if (!role || !role.isActive) {
        throw new BadRequestException('نقش انتخاب‌شده معتبر نیست');
      }
    }
    return this.prisma.user.update({
      where: { id: userId },
      data: { adminRoleId },
      select: {
        id: true,
        role: true,
        adminRoleId: true,
        adminRole: { select: { id: true, name: true, slug: true } },
      },
    });
  }

  async resolvePermissionKeysForUser(userId: string): Promise<{
    adminRoleId: string | null;
    permissions: string[];
  }> {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: {
        role: true,
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
    if (!user) return { adminRoleId: null, permissions: [] };
    if (user.role === UserRole.GODADMIN) {
      return { adminRoleId: null, permissions: ['*'] };
    }
    if (user.role !== UserRole.ADMIN) {
      return { adminRoleId: null, permissions: [] };
    }
    if (!user.adminRole?.isActive) {
      return { adminRoleId: user.adminRoleId, permissions: [] };
    }
    return {
      adminRoleId: user.adminRoleId,
      permissions: user.adminRole.permissions.map((p) => p.permission.key),
    };
  }

  private normalizeSlug(input: string): string {
    const slug = input
      .trim()
      .toLowerCase()
      .replace(/\s+/g, '-')
      .replace(/[^a-z0-9-_]/g, '')
      .replace(/-+/g, '-')
      .replace(/^-|-$/g, '');
    if (!slug) {
      throw new BadRequestException('اسلاگ نقش معتبر نیست');
    }
    return slug;
  }

  private async assertSlugAvailable(slug: string, excludeId?: string) {
    const existing = await this.prisma.adminRole.findUnique({
      where: { slug },
      select: { id: true },
    });
    if (existing && existing.id !== excludeId) {
      throw new ConflictException('اسلاگ نقش تکراری است');
    }
  }

  private assertValidPermissionKeys(keys: string[]) {
    const allowed = new Set(ADMIN_PERMISSION_CATALOG.map((p) => p.key));
    const invalid = keys.filter((k) => !allowed.has(k));
    if (invalid.length) {
      throw new BadRequestException(
        `پرمیشن‌های نامعتبر: ${invalid.slice(0, 5).join(', ')}`,
      );
    }
  }
}
