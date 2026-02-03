import { Controller, Get, Post, Body, Param, Request, UseGuards } from '@nestjs/common';
import { ChatsService } from './chats.service';
// فرض بر این است که AuthGuard دارید، اگر ندارید فعلا کامنت کنید
// import { JwtAuthGuard } from '../auth/jwt-auth.guard';

@Controller('chats')
export class ChatsController {
  constructor(private readonly chatsService: ChatsService) {}

  // ۱. شروع یا دریافت چت
  // @UseGuards(JwtAuthGuard)
  @Post('initiate')
  initiateChat(@Body('listingId') listingId: string, @Body('userId') userId: string) { // userId اضافه شد
    // اگر فرانت آیدی نفرستاد، یه چی الکی بذار (فقط برای تست)
    const finalUserId = userId || 'user-123';
    return this.chatsService.initiateChat(finalUserId, listingId);
  }

  // ۲. دریافت پیام‌ها
  @Get(':id/messages')
  getMessages(@Param('id') chatId: string) {
    return this.chatsService.getMessages(chatId);
  }

  @Post(':id/messages')
  sendMessage(
    @Param('id') chatId: string,
    @Body('text') text: string,
    @Body('userId') userId: string // userId اضافه شد
  ) {
    const finalUserId = userId || 'user-123';
    return this.chatsService.sendMessage(chatId, finalUserId, text);
  }
}