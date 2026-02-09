import { Controller, Get, Post, Body, Param, Request, UseGuards } from '@nestjs/common';
import { ChatsService } from './chats.service';
// import { JwtAuthGuard } from '../auth/jwt-auth.guard'; // اگر گارد دارید آنکامنت کنید

@Controller('chat') // 👈 نکته مهم: اسم مسیر رو به 'chat' (مفرد) تغییر دادم تا با فرانت هماهنگ بشه
export class ChatsController {
  constructor(private readonly chatsService: ChatsService) {}

  // ۱. شروع چت (از صفحه آگهی)
  // @UseGuards(JwtAuthGuard)
  @Post('initiate')
  initiateChat(
    @Request() req,
    @Body('listingId') listingId: string,
    @Body('userId') bodyUserId: string // موقت برای تست بدون توکن
  ) {
    // اولویت با آیدی داخل توکن است، اگر نبود از بادی می‌گیرد
    const userId = req.user?.id || bodyUserId;
    return this.chatsService.initiateChat(userId, listingId);
  }

  // ۲. دریافت لیست مکالمات (برای سایدبار داشبورد)
  // @UseGuards(JwtAuthGuard)
  @Get('conversations')
  getMyConversations(@Request() req, @Body('userId') bodyUserId: string) {
    const userId = req.user?.id || bodyUserId;
    return this.chatsService.getMyConversations(userId);
  }

  // ۳. دریافت پیام‌های یک مکالمه خاص
  // @UseGuards(JwtAuthGuard)
  @Get('messages/:id')
  getMessages(
    @Request() req,
    @Param('id') chatId: string,
    @Body('userId') bodyUserId: string
  ) {
    const userId = req.user?.id || bodyUserId;
    return this.chatsService.getMessages(chatId, userId);
  }

  // ۴. ارسال پیام جدید
  // @UseGuards(JwtAuthGuard)
  @Post('message')
  sendMessage(
    @Request() req,
    @Body('conversationId') conversationId: string, // نام پارامتر با فرانت هماهنگ شد
    @Body('content') content: string,               // نام پارامتر با فرانت هماهنگ شد (قبلا text بود)
    @Body('userId') bodyUserId: string
  ) {
    const userId = req.user?.id || bodyUserId;
    return this.chatsService.sendMessage(conversationId, userId, content);
  }
}