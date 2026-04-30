import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { UserRole } from '@prisma/client';
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../../auth/guards/roles.guard';
import { Roles } from '../../auth/decorators/roles.decorator';
import { PrismaService } from '../../../infrastructure/prisma/prisma.service';

@Controller('admin/contact-messages')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(UserRole.ADMIN)
export class AdminContactMessagesController {
  constructor(private readonly prisma: PrismaService) {}

  @Get()
  async list(@Query('page') page?: string, @Query('pageSize') pageSize?: string) {
    const p = Math.max(1, Number(page) || 1);
    const ps = Math.min(100, Math.max(1, Number(pageSize) || 20));
    const where = { key: { startsWith: 'CONTACT_MESSAGE_' } as any };
    const [items, total] = await Promise.all([
      this.prisma.systemSetting.findMany({
        where,
        orderBy: { updatedAt: 'desc' },
        skip: (p - 1) * ps,
        take: ps,
      }),
      this.prisma.systemSetting.count({ where }),
    ]);
    return {
      items: items.map((item) => {
        let parsed: any = {};
        try {
          parsed = JSON.parse(item.value || '{}');
        } catch {
          parsed = {};
        }
        return {
          id: item.id,
          key: item.key,
          name: parsed.name ?? '',
          phone: parsed.phone ?? '',
          email: parsed.email ?? '',
          subject: parsed.subject ?? '',
          message: parsed.message ?? '',
          createdAt: parsed.createdAt ?? item.updatedAt,
        };
      }),
      pagination: { page: p, pageSize: ps, total, totalPages: Math.max(1, Math.ceil(total / ps)) },
    };
  }
}
