import {
  Body,
  Controller,
  Delete,
  Get,
  Patch,
  Param,
  Post,
  Query,
  UseGuards,
  NotFoundException,
  ForbiddenException,
} from '@nestjs/common';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { NotificationService } from './notification.service';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { AuthenticatedUser } from '../../shared/contracts/auth';

@Controller('notifications')
@UseGuards(JwtAuthGuard)
export class NotificationController {
  constructor(private readonly service: NotificationService) {}

  @Get()
  async list(
    @CurrentUser() user: AuthenticatedUser,
    @Query('page') page?: string,
    @Query('pageSize') pageSize?: string,
    @Query('onlyUnread') onlyUnread?: string,
  ) {
    return this.service.listForUserPaginated(user.id, {
      page: page ? Number(page) : 1,
      pageSize: pageSize ? Number(pageSize) : 20,
      onlyUnread: onlyUnread === 'true',
    });
  }

  @Get('unread-count')
  unreadCount(@CurrentUser() user: AuthenticatedUser) {
    return this.service.unreadCount(user.id).then((count) => ({ count }));
  }

  @Patch('read-all')
  async markAllAsRead(@CurrentUser() user: AuthenticatedUser) {
    await this.service.markAllAsRead(user.id);
    return { ok: true };
  }

  @Patch(':id/read')
  async markAsRead(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
  ) {
    const updated = await this.service.markAsRead(user.id, id);
    if (updated === null) throw new NotFoundException('اعلان یافت نشد');
    if (updated === false) throw new ForbiddenException('دسترسی غیرمجاز');
    return updated;
  }

  @Get('push-status')
  getPushStatus(@CurrentUser() user: AuthenticatedUser) {
    return this.service.getPushStatus(user.id);
  }

  @Post('push-test')
  sendPushTest(@CurrentUser() user: AuthenticatedUser) {
    return this.service.sendPushTest(user.id);
  }

  @Post('push-subscription')
  savePushSubscription(
    @CurrentUser() user: AuthenticatedUser,
    @Body() body: { endpoint: string; keys: { p256dh: string; auth: string } },
  ) {
    return this.service.savePushSubscription(user.id, body);
  }

  @Delete('push-subscription')
  removePushSubscription(@CurrentUser() user: AuthenticatedUser) {
    return this.service.removePushSubscription(user.id);
  }
}
