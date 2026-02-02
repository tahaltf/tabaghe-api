import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { CreateTicketDto } from "./dto/create-ticket.dto";

@Injectable()
export class SupportService {
  constructor(private prisma: PrismaService) {}

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

  async getMyTickets(userId: string) {
    return this.prisma.ticket.findMany({
      where: { userId },
      orderBy: { createdAt: 'desc' },
    });
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

    if (!ticket) throw new Error('تیکت یافت نشد');

    return this.prisma.ticketMessage.create({
      data: {
        ticketId,
        message,
        senderRole: 'USER',
      },
    });
  }
}
