import {
  Body,
  Controller,
  Delete,
  Get,
  NotFoundException,
  Param,
  Patch,
  Query,
  UseGuards,
} from '@nestjs/common';
import { UserRole } from '@prisma/client';
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../../auth/guards/roles.guard';
import { Roles } from '../../auth/decorators/roles.decorator';
import { PrismaService } from '../../../infrastructure/prisma/prisma.service';

interface ContactMessagePayload {
  name?: string;
  phone?: string;
  email?: string;
  subject?: string;
  message?: string;
  createdAt?: string;
  isRead?: boolean;
  readAt?: string | null;
}

function parsePayload(raw: string | null | undefined): ContactMessagePayload {
  try {
    const parsed = JSON.parse(raw || '{}');
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
}

function serializeItem(item: {
  id: string;
  key: string;
  value: string | null;
  updatedAt: Date;
}) {
  const parsed = parsePayload(item.value);
  return {
    id: item.id,
    key: item.key,
    name: parsed.name ?? '',
    phone: parsed.phone ?? '',
    email: parsed.email ?? '',
    subject: parsed.subject ?? '',
    message: parsed.message ?? '',
    isRead: parsed.isRead === true,
    readAt: parsed.readAt ?? null,
    createdAt: parsed.createdAt ?? item.updatedAt.toISOString(),
  };
}

@Controller('admin/contact-messages')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(UserRole.ADMIN)
export class AdminContactMessagesController {
  constructor(private readonly prisma: PrismaService) {}

  @Get()
  async list(
    @Query('page') page?: string,
    @Query('pageSize') pageSize?: string,
  ) {
    const p = Math.max(1, Number(page) || 1);
    const ps = Math.min(100, Math.max(1, Number(pageSize) || 20));
    const where = { key: { startsWith: 'CONTACT_MESSAGE_' } as any };
    const [items, total, unreadItems] = await Promise.all([
      this.prisma.systemSetting.findMany({
        where,
        orderBy: { updatedAt: 'desc' },
        skip: (p - 1) * ps,
        take: ps,
      }),
      this.prisma.systemSetting.count({ where }),
      this.prisma.systemSetting.findMany({
        where,
        select: { value: true },
      }),
    ]);

    const unreadCount = unreadItems.reduce((acc, row) => {
      const parsed = parsePayload(row.value);
      return acc + (parsed.isRead === true ? 0 : 1);
    }, 0);

    return {
      items: items.map(serializeItem),
      pagination: {
        page: p,
        pageSize: ps,
        total,
        totalPages: Math.max(1, Math.ceil(total / ps)),
      },
      stats: {
        total,
        unread: unreadCount,
      },
    };
  }

  @Patch(':id/read')
  async toggleRead(
    @Param('id') id: string,
    @Body() body: { isRead?: boolean },
  ) {
    const existing = await this.prisma.systemSetting.findUnique({
      where: { id },
    });
    if (!existing || !existing.key.startsWith('CONTACT_MESSAGE_')) {
      throw new NotFoundException('پیام تماس یافت نشد');
    }
    const parsed = parsePayload(existing.value);
    const nextIsRead = body?.isRead ?? !parsed.isRead;
    const nextValue = JSON.stringify({
      ...parsed,
      isRead: nextIsRead,
      readAt: nextIsRead ? new Date().toISOString() : null,
    });
    const updated = await this.prisma.systemSetting.update({
      where: { id },
      data: { value: nextValue },
    });
    return serializeItem(updated);
  }

  @Delete(':id')
  async remove(@Param('id') id: string) {
    const existing = await this.prisma.systemSetting.findUnique({
      where: { id },
    });
    if (!existing || !existing.key.startsWith('CONTACT_MESSAGE_')) {
      throw new NotFoundException('پیام تماس یافت نشد');
    }
    await this.prisma.systemSetting.delete({ where: { id } });
    return { ok: true, id };
  }
}
