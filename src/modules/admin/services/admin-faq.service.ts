import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../../infrastructure/prisma/prisma.service';
import { CreateFaqDto, UpdateFaqDto } from '../dto/admin-faq.dto';

@Injectable()
export class AdminFaqService {
  constructor(private readonly prisma: PrismaService) {}

  list() {
    return this.prisma.faq.findMany({
      orderBy: [{ order: 'asc' }, { createdAt: 'asc' }],
    });
  }

  async get(id: string) {
    const row = await this.prisma.faq.findUnique({ where: { id } });
    if (!row) throw new NotFoundException('سوال یافت نشد');
    return row;
  }

  create(dto: CreateFaqDto) {
    return this.prisma.faq.create({
      data: {
        question: dto.question,
        answer: dto.answer,
        category: dto.category ?? null,
        order: dto.order ?? 0,
        isActive: dto.isActive ?? true,
      },
    });
  }

  async update(id: string, dto: UpdateFaqDto) {
    await this.get(id);
    return this.prisma.faq.update({
      where: { id },
      data: {
        ...(dto.question !== undefined ? { question: dto.question } : {}),
        ...(dto.answer !== undefined ? { answer: dto.answer } : {}),
        ...(dto.category !== undefined ? { category: dto.category } : {}),
        ...(dto.order !== undefined ? { order: dto.order } : {}),
        ...(dto.isActive !== undefined ? { isActive: dto.isActive } : {}),
      },
    });
  }

  async remove(id: string) {
    await this.get(id);
    await this.prisma.faq.delete({ where: { id } });
    return { ok: true };
  }
}
