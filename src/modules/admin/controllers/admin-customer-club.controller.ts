import { Controller, Get, Query, UseGuards, Header } from '@nestjs/common';
import { UserRole } from '@prisma/client';
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../../auth/guards/roles.guard';
import { Roles } from '../../auth/decorators/roles.decorator';
import { PrismaService } from '../../../infrastructure/prisma/prisma.service';
import { RawResponse } from '../../../common/decorators/raw-response.decorator';

type ClubItem = {
  id: string;
  type: 'PHONE' | 'EMAIL';
  contact: string;
  phone: string | null;
  email: string | null;
  createdAt: string;
};

function normalizePhoneForExport(phone: string): string {
  const digits = String(phone ?? '').replace(/\D/g, '');
  if (!digits) return '';
  if (digits.startsWith('0')) return digits.slice(1);
  if (digits.startsWith('98')) return digits.slice(2);
  return digits;
}

function parseClubValue(value: string | null | undefined): {
  phone: string | null;
  email: string | null;
  createdAt: string | null;
} {
  try {
    const parsed = JSON.parse(value || '{}') as Record<string, unknown>;
    const phone =
      typeof parsed['phone'] === 'string' ? parsed['phone'].trim() : null;
    const email =
      typeof parsed['email'] === 'string' ? parsed['email'].trim() : null;
    const createdAt =
      typeof parsed['createdAt'] === 'string' ? parsed['createdAt'].trim() : null;
    return { phone, email, createdAt };
  } catch {
    return { phone: null, email: null, createdAt: null };
  }
}

@Controller('admin/customer-club')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(UserRole.ADMIN)
export class AdminCustomerClubController {
  constructor(private readonly prisma: PrismaService) {}

  private toItem(row: {
    id: string;
    key: string;
    value: string;
    updatedAt: Date;
  }): ClubItem | null {
    const payload = parseClubValue(row.value);
    const key = row.key;
    const phoneFromKey = key.startsWith('CUSTOMER_CLUB_PHONE_')
      ? key.slice('CUSTOMER_CLUB_PHONE_'.length).trim()
      : null;
    const emailFromKey = key.startsWith('CUSTOMER_CLUB_EMAIL_')
      ? key.slice('CUSTOMER_CLUB_EMAIL_'.length).trim().toLowerCase()
      : null;

    const phone = payload.phone || phoneFromKey;
    const email = payload.email || emailFromKey;
    const createdAt = payload.createdAt || row.updatedAt.toISOString();

    if (phone) {
      return {
        id: row.id,
        type: 'PHONE',
        contact: phone,
        phone,
        email: null,
        createdAt,
      };
    }
    if (email) {
      return {
        id: row.id,
        type: 'EMAIL',
        contact: email,
        phone: null,
        email,
        createdAt,
      };
    }
    return null;
  }

  @Get()
  async list(@Query('page') page?: string, @Query('pageSize') pageSize?: string) {
    const p = Math.max(1, Number(page) || 1);
    const ps = Math.min(500, Math.max(1, Number(pageSize) || 50));

    const where = { key: { startsWith: 'CUSTOMER_CLUB_' } as const };
    const [rows, total] = await Promise.all([
      this.prisma.systemSetting.findMany({
        where,
        orderBy: { updatedAt: 'desc' },
        skip: (p - 1) * ps,
        take: ps,
        select: { id: true, key: true, value: true, updatedAt: true },
      }),
      this.prisma.systemSetting.count({ where }),
    ]);

    const items = rows
      .map((row) => this.toItem(row))
      .filter((x): x is ClubItem => x !== null);
    const phones = items.filter((x) => x.type === 'PHONE').length;
    const emails = items.filter((x) => x.type === 'EMAIL').length;

    return {
      items,
      pagination: {
        page: p,
        pageSize: ps,
        total,
        totalPages: Math.max(1, Math.ceil(total / ps)),
      },
      stats: { total, phones, emails },
    };
  }

  @Get('export.txt')
  @RawResponse()
  @Header('Content-Type', 'text/plain; charset=utf-8')
  @Header(
    'Content-Disposition',
    'attachment; filename="customer-club-phones.txt"',
  )
  async exportPhonesTxt(): Promise<string> {
    const rows = await this.prisma.systemSetting.findMany({
      where: { key: { startsWith: 'CUSTOMER_CLUB_' } as const },
      orderBy: { updatedAt: 'desc' },
      select: { key: true, value: true },
    });

    const unique = new Set<string>();
    for (const row of rows) {
      const payload = parseClubValue(row.value);
      const phoneFromKey = row.key.startsWith('CUSTOMER_CLUB_PHONE_')
        ? row.key.slice('CUSTOMER_CLUB_PHONE_'.length).trim()
        : '';
      const candidate = payload.phone || phoneFromKey;
      const normalized = normalizePhoneForExport(candidate);
      if (!normalized) continue;
      unique.add(normalized);
    }

    return [...unique].join('\n');
  }
}

