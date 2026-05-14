import { Injectable, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../infrastructure/prisma/prisma.service';

@Injectable()
export class IdempotencyService {
  constructor(private readonly prisma: PrismaService) {}

  async execute<T>(params: {
    key: string;
    userId: string;
    endpoint: string;
    handler: () => Promise<T>;
  }): Promise<T> {
    const { key, userId, endpoint, handler } = params;

    const existing = await this.prisma.idempotencyKey.findUnique({
      where: { key },
    });

    if (existing) {
      if (existing.userId !== userId) {
        throw new BadRequestException(
          'کلید یکتایی (Idempotency) با درخواست قبلی هم‌خوان نیست',
        );
      }
      return existing.response as T;
    }

    const result = await handler();

    await this.prisma.idempotencyKey.create({
      data: {
        key,
        userId,
        endpoint,
        response: result as any,
      },
    });

    return result;
  }
}
