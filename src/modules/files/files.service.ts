import { Injectable } from '@nestjs/common';
import { UserRole } from '@prisma/client';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { AuthenticatedUser } from '../../shared/contracts/auth';

@Injectable()
export class FilesService {
  constructor(private readonly prisma: PrismaService) {}

  async canAccessFile(
    user: AuthenticatedUser,
    category: string,
    filename: string,
  ): Promise<boolean> {
    if (user.role === UserRole.ADMIN || user.role === UserRole.GODADMIN) {
      return true;
    }

    switch (category) {
      case 'national-cards':
        return this.canAccessNationalCard(user.id, filename);
      case 'tickets':
        return this.canAccessTicketAttachment(user.id, filename);
      case 'deposit-receipts':
        return this.canAccessDepositReceipt(user.id, filename);
      default:
        return false;
    }
  }

  private async canAccessNationalCard(userId: string, filename: string): Promise<boolean> {
    const owner = await this.prisma.user.findFirst({
      where: { id: userId, nationalCardImage: filename },
      select: { id: true },
    });
    return !!owner;
  }

  private async canAccessTicketAttachment(userId: string, filename: string): Promise<boolean> {
    const tickets = await this.prisma.ticket.findMany({
      where: { userId },
      select: { messages: { select: { attachments: true } } },
    });

    for (const ticket of tickets) {
      for (const message of ticket.messages) {
        const attachments = message.attachments;
        if (!attachments) continue;
        const serialized = JSON.stringify(attachments);
        if (serialized.includes(filename)) return true;
      }
    }
    return false;
  }

  private async canAccessDepositReceipt(userId: string, filename: string): Promise<boolean> {
    const wallet = await this.prisma.wallet.findUnique({
      where: { userId },
      select: { id: true },
    });
    if (!wallet) return false;

    const needle = `deposit-receipts/${filename}`;
    const transactions = await this.prisma.walletTransaction.findMany({
      where: { walletId: wallet.id },
      select: { meta: true },
      take: 200,
      orderBy: { createdAt: 'desc' },
    });

    return transactions.some((tx) => {
      const meta = tx.meta as { receiptImage?: string | null } | null;
      return meta?.receiptImage === needle || meta?.receiptImage?.endsWith(`/${filename}`);
    });
  }
}
