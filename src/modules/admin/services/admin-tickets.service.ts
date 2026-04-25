import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { NotificationType, Prisma, TicketStatus, UserRole } from '@prisma/client';
import { PrismaService } from '../../../infrastructure/prisma/prisma.service';
import { NotificationService } from '../../notification/notification.service';
import {
  buildPaginationMeta,
  PaginatedResult,
} from '../../../shared/contracts/pagination';
import { AdminTicketListQueryDto } from '../dto/admin-query.dto';
import {
  AdminReplyTicketDto,
  AdminUpdateTicketDto,
} from '../dto/admin-ticket.dto';

const TICKET_INCLUDE = {
  user: { select: { id: true, phone: true, firstName: true, lastName: true } },
  repairRequest: { select: { id: true, trackingCode: true } },
  _count: { select: { messages: true } },
} satisfies Prisma.TicketInclude;

const TICKET_DETAIL_INCLUDE = {
  user: { select: { id: true, phone: true, firstName: true, lastName: true } },
  repairRequest: { select: { id: true, trackingCode: true } },
  messages: { orderBy: { createdAt: 'asc' } },
} satisfies Prisma.TicketInclude;

export type AdminTicketItem = Prisma.TicketGetPayload<{ include: typeof TICKET_INCLUDE }>;
export type AdminTicketDetail = Prisma.TicketGetPayload<{ include: typeof TICKET_DETAIL_INCLUDE }>;

@Injectable()
export class AdminTicketsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly notification: NotificationService,
  ) {}

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

    const [items, total] = await Promise.all([
      this.prisma.ticket.findMany({
        where,
        include: TICKET_INCLUDE,
        orderBy: { createdAt: 'desc' },
        skip,
        take: pageSize,
      }),
      this.prisma.ticket.count({ where }),
    ]);

    return { items, pagination: buildPaginationMeta(page, pageSize, total) };
  }

  async detail(id: string): Promise<AdminTicketDetail> {
    const ticket = await this.prisma.ticket.findUnique({
      where: { id },
      include: TICKET_DETAIL_INCLUDE,
    });
    if (!ticket) throw new NotFoundException('تیکت یافت نشد');
    return ticket;
  }

  async reply(id: string, dto: AdminReplyTicketDto): Promise<AdminTicketDetail> {
    const ticket = await this.prisma.ticket.findUnique({ where: { id } });
    if (!ticket) throw new NotFoundException('تیکت یافت نشد');
    if (ticket.status === TicketStatus.CLOSED) {
      throw new BadRequestException('این تیکت بسته شده است');
    }
    await this.prisma.$transaction([
      this.prisma.ticketMessage.create({
        data: {
          ticketId: id,
          senderRole: UserRole.ADMIN,
          message: dto.message,
        },
      }),
      this.prisma.ticket.update({
        where: { id },
        data: { status: TicketStatus.ANSWERED },
      }),
    ]);

    try {
      await this.notification.create({
        userId: ticket.userId,
        type: NotificationType.TICKET_REPLY,
        title: 'پاسخ جدید پشتیبانی',
        message: `برای تیکت «${ticket.subject}» پاسخ جدید ثبت شد.`,
        meta: { ticketId: ticket.id },
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
