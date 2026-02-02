import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { NotificationType } from '@prisma/client';

@Injectable()
export class NotificationService {
    constructor(private readonly prisma: PrismaService) {}

    async create(params: {
        userId: string;
        type: NotificationType;
        title: string;
        message: string;
        meta?: Record<string, any>;
    }) {
        const { userId, type, title, message, meta } = params;

        return this.prisma.notification.create({
            data: {
                userId,
                type,
                title,
                message,
                meta,
            },
        });
    }
}
