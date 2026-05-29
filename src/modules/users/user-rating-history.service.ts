import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';

export type RecordUserRatingChangeParams = {
  userId: string;
  previous: number;
  next: number;
  reason: string;
  source: string;
  orderId?: string;
  listingId?: string;
  actorId?: string;
};

@Injectable()
export class UserRatingHistoryService {
  constructor(private readonly prisma: PrismaService) {}

  async record(
    tx: Prisma.TransactionClient | PrismaService,
    params: RecordUserRatingChangeParams,
  ): Promise<void> {
    const previous = Number(params.previous);
    const next = Number(params.next);
    const delta = next - previous;
    if (!Number.isFinite(previous) || !Number.isFinite(next)) return;
    if (Math.abs(delta) < 0.0001) return;

    await tx.userRatingHistory.create({
      data: {
        userId: params.userId,
        previous,
        next,
        delta,
        reason: params.reason.trim().slice(0, 2000) || '—',
        source: params.source,
        orderId: params.orderId,
        listingId: params.listingId,
        actorId: params.actorId,
      },
    });
  }

  listForUser(userId: string, limit = 50) {
    return this.prisma.userRatingHistory.findMany({
      where: { userId },
      orderBy: { createdAt: 'desc' },
      take: Math.min(100, Math.max(1, limit)),
    });
  }
}
