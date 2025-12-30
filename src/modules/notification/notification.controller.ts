import {
    Controller,
    Get,
    Patch,
    Param,
    Req,
    UseGuards,
    NotFoundException,
    ForbiddenException,
} from '@nestjs/common';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { PrismaService } from '../../prisma/prisma.service';

@Controller('notifications')
@UseGuards(JwtAuthGuard)
export class NotificationController {
    constructor(private readonly prisma: PrismaService) {}

    // -----------------------------------
    // Get my notifications
    // -----------------------------------
    @Get()
    async getMyNotifications(@Req() req) {
        const userId = req.user.id;

        return this.prisma.notification.findMany({
            where: { userId },
            orderBy: { createdAt: 'desc' },
        });
    }

    // -----------------------------------
    // Mark notification as read
    // -----------------------------------
    @Patch(':id/read')
    async markAsRead(
        @Req() req,
        @Param('id') id: string,
    ) {
        const userId = req.user.id;

        const notification = await this.prisma.notification.findUnique({
            where: { id },
        });

        if (!notification) {
            throw new NotFoundException('Notification not found');
        }

        if (notification.userId !== userId) {
            throw new ForbiddenException('Access denied');
        }

        return this.prisma.notification.update({
            where: { id },
            data: { isRead: true },
        });
    }

    // -----------------------------------
    // Mark all notifications as read
    // -----------------------------------
    @Patch('read-all')
    async markAllAsRead(@Req() req) {
        const userId = req.user.id;

        await this.prisma.notification.updateMany({
            where: {
                userId,
                isRead: false,
            },
            data: {
                isRead: true,
            },
        });

        return { ok: true };
    }
}
