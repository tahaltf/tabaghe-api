import {
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { CreateTicketDto } from "./dto/create-ticket.dto";

@Injectable()
export class SupportService {
  constructor(private readonly prisma: PrismaService) {}

  async createTicket(userId: string, dto: CreateTicketDto) {
    return this.prisma.ticket.create({
      data: {
        userId,
        subject: dto.subject,
        repairRequestId: dto.repairRequestId,
        messages: {
          create: {
            message: dto.message,
            senderRole: 'USER',
          },
        },
      },
      include: { messages: true },
    });
  }

  async getMyTickets(
    userId: string,
    options: { page?: number; pageSize?: number } = {},
  ) {
    const page = Math.max(1, options.page ?? 1);
    const pageSize = Math.min(50, Math.max(1, options.pageSize ?? 20));
    const skip = (page - 1) * pageSize;

    const where = { userId };
    const [items, total] = await this.prisma.$transaction([
      this.prisma.ticket.findMany({
        where,
        skip,
        take: pageSize,
        orderBy: { createdAt: 'desc' },
        select: {
          id: true,
          subject: true,
          status: true,
          createdAt: true,
          repairRequestId: true,
        },
      }),
      this.prisma.ticket.count({ where }),
    ]);

    return {
      items,
      pagination: {
        page,
        pageSize,
        total,
        totalPages: Math.max(1, Math.ceil(total / pageSize)),
      },
    };
  }

  async getTicketDetails(ticketId: string, userId: string) {
    return this.prisma.ticket.findFirst({
      where: { id: ticketId, userId },
      include: {
        messages: { orderBy: { createdAt: 'asc' } },
        repairRequest: true,
      },
    });
  }
  async sendMessage(ticketId: string, userId: string, message: string) {
    // ابتدا مطمئن می‌شویم تیکت متعلق به همین کاربر است
    const ticket = await this.prisma.ticket.findFirst({
      where: { id: ticketId, userId }
    });

    if (!ticket) throw new NotFoundException('تیکت یافت نشد');

    const created = await this.prisma.ticketMessage.create({
      data: {
        ticketId,
        message,
        senderRole: 'USER',
      },
    });
    await this.prisma.ticket.update({
      where: { id: ticketId },
      data: { status: 'OPEN' },
    });
    return created;
  }
}
