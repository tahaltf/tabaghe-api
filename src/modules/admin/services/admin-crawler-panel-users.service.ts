import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
  ServiceUnavailableException,
  UnauthorizedException,
} from '@nestjs/common';
import * as bcrypt from 'bcrypt';
import { PrismaService } from '../../../infrastructure/prisma/prisma.service';
import {
  CreateCrawlerAccessDto,
  CreateCrawlerPanelUserDto,
  UpdateCrawlerPanelUserDto,
} from '../dto/admin-crawler-panel-user.dto';
import { AdminCrawlerIpAllowlistService } from './admin-crawler-ip-allowlist.service';
import {
  generateCrawlerPanelPassword,
  normalizeCrawlerUsername,
} from './crawler-panel-password.util';

export type CrawlerPanelUserPublic = {
  id: string;
  username: string;
  displayName: string;
  enabled: boolean;
  notes: string | null;
  ipAllowlistEntryId: string | null;
  ipCidr: string | null;
  ipName: string | null;
  lastLoginAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
};

@Injectable()
export class AdminCrawlerPanelUsersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly ipAllowlist: AdminCrawlerIpAllowlistService,
  ) {}

  private sharedGateSecret(): string {
    return (process.env.CRAWLER_GATE_SHARED_SECRET || '').trim();
  }

  assertGateSecret(candidate: string | undefined): void {
    const expected = this.sharedGateSecret();
    if (!expected) {
      throw new ServiceUnavailableException(
        'ورود پنل کرالر پیکربندی نشده است (CRAWLER_GATE_SHARED_SECRET)',
      );
    }
    if (!candidate || candidate.trim() !== expected) {
      throw new UnauthorizedException('کلید احراز هویت کرالر نامعتبر است');
    }
  }

  private toPublic(row: {
    id: string;
    username: string;
    displayName: string;
    enabled: boolean;
    notes: string | null;
    ipAllowlistEntryId: string | null;
    lastLoginAt: Date | null;
    createdAt: Date;
    updatedAt: Date;
    ipAllowlistEntry?: { ipCidr: string; name: string } | null;
  }): CrawlerPanelUserPublic {
    return {
      id: row.id,
      username: row.username,
      displayName: row.displayName,
      enabled: row.enabled,
      notes: row.notes,
      ipAllowlistEntryId: row.ipAllowlistEntryId,
      ipCidr: row.ipAllowlistEntry?.ipCidr ?? null,
      ipName: row.ipAllowlistEntry?.name ?? null,
      lastLoginAt: row.lastLoginAt,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
    };
  }

  list() {
    return this.prisma.crawlerPanelUser
      .findMany({
        orderBy: [{ enabled: 'desc' }, { username: 'asc' }],
        include: { ipAllowlistEntry: { select: { ipCidr: true, name: true } } },
      })
      .then((rows) => rows.map((r) => this.toPublic(r)));
  }

  async get(id: string) {
    const row = await this.prisma.crawlerPanelUser.findUnique({
      where: { id },
      include: { ipAllowlistEntry: { select: { ipCidr: true, name: true } } },
    });
    if (!row) throw new NotFoundException('کاربر پنل کرالر یافت نشد');
    return this.toPublic(row);
  }

  private async createUserWithPassword(
    dto: CreateCrawlerPanelUserDto,
  ): Promise<{ user: CrawlerPanelUserPublic; plainPassword: string }> {
    const username = normalizeCrawlerUsername(dto.username);
    const plainPassword = generateCrawlerPanelPassword(20);
    const passwordHash = await bcrypt.hash(plainPassword, 10);

    if (dto.ipAllowlistEntryId) {
      const ip = await this.prisma.crawlerIpAllowlistEntry.findUnique({
        where: { id: dto.ipAllowlistEntryId },
      });
      if (!ip) throw new BadRequestException('رکورد IP مرتبط یافت نشد');
    }

    try {
      const row = await this.prisma.crawlerPanelUser.create({
        data: {
          username,
          passwordHash,
          displayName: dto.displayName.trim(),
          enabled: dto.enabled ?? true,
          notes: dto.notes?.trim() || null,
          ipAllowlistEntryId: dto.ipAllowlistEntryId || null,
        },
        include: { ipAllowlistEntry: { select: { ipCidr: true, name: true } } },
      });
      return { user: this.toPublic(row), plainPassword };
    } catch (e: unknown) {
      if ((e as { code?: string })?.code === 'P2002') {
        throw new ConflictException('این نام کاربری قبلاً ثبت شده است');
      }
      throw e;
    }
  }

  create(dto: CreateCrawlerPanelUserDto) {
    return this.createUserWithPassword(dto);
  }

  async createAccess(dto: CreateCrawlerAccessDto) {
    const ip = await this.ipAllowlist.create({
      name: dto.name,
      ipCidr: dto.ipCidr,
      enabled: dto.enabled ?? true,
      notes: dto.notes,
    });
    try {
      const { user, plainPassword } = await this.createUserWithPassword({
        username: dto.username,
        displayName: dto.name.trim(),
        enabled: dto.enabled ?? true,
        notes: dto.notes,
        ipAllowlistEntryId: ip.id,
      });
      return {
        ip,
        user,
        plainPassword,
        sync: ip.sync,
      };
    } catch (err) {
      // Roll back IP if user creation fails (e.g. duplicate username)
      try {
        await this.ipAllowlist.remove(ip.id);
      } catch {
        /* ignore */
      }
      throw err;
    }
  }

  async update(id: string, dto: UpdateCrawlerPanelUserDto) {
    await this.get(id);
    if (dto.ipAllowlistEntryId) {
      const ip = await this.prisma.crawlerIpAllowlistEntry.findUnique({
        where: { id: dto.ipAllowlistEntryId },
      });
      if (!ip) throw new BadRequestException('رکورد IP مرتبط یافت نشد');
    }
    const row = await this.prisma.crawlerPanelUser.update({
      where: { id },
      data: {
        ...(dto.displayName !== undefined
          ? { displayName: dto.displayName.trim() }
          : {}),
        ...(dto.enabled !== undefined ? { enabled: dto.enabled } : {}),
        ...(dto.notes !== undefined ? { notes: dto.notes?.trim() || null } : {}),
        ...(dto.ipAllowlistEntryId !== undefined
          ? { ipAllowlistEntryId: dto.ipAllowlistEntryId || null }
          : {}),
      },
      include: { ipAllowlistEntry: { select: { ipCidr: true, name: true } } },
    });
    return this.toPublic(row);
  }

  async resetPassword(id: string) {
    await this.get(id);
    const plainPassword = generateCrawlerPanelPassword(20);
    const passwordHash = await bcrypt.hash(plainPassword, 10);
    const row = await this.prisma.crawlerPanelUser.update({
      where: { id },
      data: { passwordHash },
      include: { ipAllowlistEntry: { select: { ipCidr: true, name: true } } },
    });
    return { user: this.toPublic(row), plainPassword };
  }

  async remove(id: string) {
    await this.get(id);
    await this.prisma.crawlerPanelUser.delete({ where: { id } });
    return { ok: true };
  }

  async verifyLogin(usernameRaw: string, password: string) {
    const username = normalizeCrawlerUsername(usernameRaw);
    const row = await this.prisma.crawlerPanelUser.findUnique({
      where: { username },
    });
    if (!row || !row.enabled) {
      throw new UnauthorizedException('نام کاربری یا رمز عبور نادرست است');
    }
    const ok = await bcrypt.compare(password, row.passwordHash);
    if (!ok) {
      throw new UnauthorizedException('نام کاربری یا رمز عبور نادرست است');
    }
    await this.prisma.crawlerPanelUser.update({
      where: { id: row.id },
      data: { lastLoginAt: new Date() },
    });
    return {
      ok: true as const,
      username: row.username,
      displayName: row.displayName,
      userId: row.id,
    };
  }
}
