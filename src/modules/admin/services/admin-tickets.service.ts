import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  Prisma,
  TicketStatus,
  UserRole,
} from '@prisma/client';
import { PrismaService } from '../../../infrastructure/prisma/prisma.service';
import { NotificationService } from '../../notification/notification.service';
import {
  buildPaginationMeta,
  PaginatedResult,
} from '../../../shared/contracts/pagination';
import { AdminTicketListQueryDto } from '../dto/admin-query.dto';
import {
  AdminCreateTicketDto,
  AdminReplyTicketDto,
  AdminUpdateTicketDto,
} from '../dto/admin-ticket.dto';
import { normalizeTicketMessage } from '../../../common/ticket-message.util';
import { AdminUserPlanLookupService } from './admin-user-plan-lookup.service';
import type { AdminUserPlanInfo } from './admin-user-plan-lookup.service';
import { TicketAttachmentSettingsService } from '../../support/ticket-attachment-settings.service';

const TICKET_INCLUDE = {
  user: { select: { id: true, phone: true, firstName: true, lastName: true, displayName: true } },
  repairRequest: { select: { id: true, trackingCode: true } },
  _count: { select: { messages: true } },
} satisfies Prisma.TicketInclude;

const TICKET_DETAIL_INCLUDE = {
  user: { select: { id: true, phone: true, firstName: true, lastName: true, displayName: true } },
  repairRequest: { select: { id: true, trackingCode: true } },
  messages: { orderBy: { createdAt: 'asc' } },
} satisfies Prisma.TicketInclude;

type AdminTicketUser = Prisma.TicketGetPayload<{
  include: typeof TICKET_INCLUDE;
}>['user'] & { activePlan: AdminUserPlanInfo | null };

export type AdminTicketItem = Omit<
  Prisma.TicketGetPayload<{ include: typeof TICKET_INCLUDE }>,
  'user'
> & { user: AdminTicketUser };

export type AdminTicketDetail = Omit<
  Prisma.TicketGetPayload<{ include: typeof TICKET_DETAIL_INCLUDE }>,
  'user'
> & { user: AdminTicketUser };

@Injectable()
export class AdminTicketsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly notification: NotificationService,
    private readonly userPlanLookup: AdminUserPlanLookupService,
    private readonly ticketAttachments: TicketAttachmentSettingsService,
  ) {}

  private async attachUserPlans<
    T extends { user: { id: string } },
  >(items: T[]): Promise<Array<T & { user: T['user'] & { activePlan: AdminUserPlanInfo | null } }>> {
    const userIds = [...new Set(items.map((i) => i.user.id))];
    const planByUser = await this.userPlanLookup.loadActivePlansForUsers(userIds);
    return items.map((item) => ({
      ...item,
      user: {
        ...item.user,
        activePlan: planByUser.get(item.user.id) ?? null,
      },
    }));
  }

  async list(
    query: AdminTicketListQueryDto,
  ): Promise<PaginatedResult<AdminTicketItem>> {
    const page = query.page ?? 1;
    const pageSize = query.pageSize ?? 20;
    const skip = (page - 1) * pageSize;

    const where: Prisma.TicketWhereInput = {};
    if (query.status) where.status = query.status;
    if (query.search) {
      const s = query.search.trim();
      where.OR = [
        { subject: { contains: s, mode: 'insensitive' } },
        { user: { phone: { contains: s } } },
        { user: { firstName: { contains: s, mode: 'insensitive' } } },
        { user: { lastName: { contains: s, mode: 'insensitive' } } },
      ];
    }

    const sortField =
      query.sortBy === 'createdAt' ? 'createdAt' : 'lastMessageAt';
    const sortDir = query.sortDir === 'asc' ? 'asc' : 'desc';

    const [rawItems, total] = await Promise.all([
      this.prisma.ticket.findMany({
        where,
        include: TICKET_INCLUDE,
        orderBy: { [sortField]: sortDir },
        skip,
        take: pageSize,
      }),
      this.prisma.ticket.count({ where }),
    ]);

    const items = await this.attachUserPlans(rawItems);

    return { items, pagination: buildPaginationMeta(page, pageSize, total) };
  }

  async detail(id: string): Promise<AdminTicketDetail> {
    const ticket = await this.prisma.ticket.findUnique({
      where: { id },
      include: TICKET_DETAIL_INCLUDE,
    });
    if (!ticket) throw new NotFoundException('تیکت یافت نشد');
    const [enriched] = await this.attachUserPlans([ticket]);
    return enriched;
  }

  async createForUser(
    userId: string,
    dto: AdminCreateTicketDto,
    file?: Express.Multer.File,
  ): Promise<AdminTicketDetail> {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { id: true },
    });
    if (!user) throw new NotFoundException('کاربر یافت نشد');

    const message = normalizeTicketMessage(dto.message);
    const attachments = await this.ticketAttachments.validateAndBuildAttachment(
      file,
    );
    if (!message && !attachments?.length) {
      throw new BadRequestException('متن پیام یا فایل پیوست الزامی است');
    }

    const created = await this.prisma.ticket.create({
      data: {
        userId,
        subject: dto.subject.trim(),
        status: TicketStatus.ANSWERED,
        messages: {
          create: {
            senderRole: UserRole.ADMIN,
            message,
            attachments: attachments ?? undefined,
          },
        },
      },
      select: { id: true },
    });

    try {
      await this.notification.notifyUserTicket({
        userId,
        ticketId: created.id,
        subject: dto.subject.trim(),
        title: 'تیکت جدید از سمت پشتیبانی',
        message: `تیکت جدیدی با عنوان «${dto.subject.trim()}» برای شما ثبت شد.`,
      });
    } catch {
      // ignore notification errors
    }

    return this.detail(created.id);
  }

  async reply(
    id: string,
    dto: AdminReplyTicketDto,
    file?: Express.Multer.File,
  ): Promise<AdminTicketDetail> {
    const ticket = await this.prisma.ticket.findUnique({ where: { id } });
    if (!ticket) throw new NotFoundException('تیکت یافت نشد');
    if (ticket.status === TicketStatus.CLOSED) {
      throw new BadRequestException('این تیکت بسته شده است');
    }

    const message = normalizeTicketMessage(dto.message);
    const attachments = await this.ticketAttachments.validateAndBuildAttachment(
      file,
    );
    if (!message && !attachments?.length) {
      throw new BadRequestException('متن پیام یا فایل پیوست الزامی است');
    }

    const now = new Date();
    await this.prisma.$transaction([
      this.prisma.ticketMessage.create({
        data: {
          ticketId: id,
          senderRole: UserRole.ADMIN,
          message,
          attachments: attachments ?? undefined,
        },
      }),
      this.prisma.ticket.update({
        where: { id },
        data: { status: TicketStatus.ANSWERED, lastMessageAt: now },
      }),
    ]);

    try {
      await this.notification.notifyUserTicket({
        userId: ticket.userId,
        ticketId: ticket.id,
        subject: ticket.subject,
        title: 'پاسخ جدید پشتیبانی',
        message: `برای تیکت «${ticket.subject}» پاسخ جدید ثبت شد.`,
      });
    } catch {
      // ignore notification errors to avoid breaking reply flow
    }

    return this.detail(id);
  }

  async updateStatus(
    id: string,
    dto: AdminUpdateTicketDto,
  ): Promise<AdminTicketDetail> {
    if (!dto.status) {
      throw new BadRequestException('وضعیت الزامی است');
    }
    await this.prisma.ticket.update({
      where: { id },
      data: { status: dto.status },
    });
    return this.detail(id);
  }
}
