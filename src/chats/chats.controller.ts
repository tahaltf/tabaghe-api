import { Controller, Get, Post, Body, Param, Request, Query, UseGuards } from '@nestjs/common';
import { ChatsService } from './chats.service';
// import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';

@Controller('chat')
export class ChatsController {
  constructor(private readonly chatsService: ChatsService) {}

  @Post('initiate')
  async initiateChat(
    @Request() req,
    @Body('listingId') listingId: string,
    @Body('userId') bodyUserId: string
  ) {
    const userId = req.user?.id || bodyUserId;
    return this.chatsService.initiateChat(userId, listingId);
  }

  @Get('conversations')
  async getMyConversations(
    @Request() req,
    @Query('userId') queryUserId: string // ✅ دریافت از کوئری (?userId=...)
  ) {
    const userId = req.user?.id || queryUserId;
    return this.chatsService.getMyConversations(userId);
  }

  @Get('messages/:id')
  async getMessages(
    @Request() req,
    @Param('id') chatId: string,
    @Query('userId') queryUserId: string // ✅ دریافت از کوئری (?userId=...)
  ) {
    const userId = req.user?.id || queryUserId;
    // لاگ برای دیباگ در کنسول
    console.log('--- Controller Check ---');
    console.log('Chat ID:', chatId);
    console.log('User ID from Request:', userId);

    return this.chatsService.getMessages(chatId, userId);
  }

  @Post('message')
  async sendMessage(
    @Request() req,
    @Body('conversationId') conversationId: string,
    @Body('content') content: string,
    @Body('userId') bodyUserId: string
  ) {
    const userId = req.user?.id || bodyUserId;
    return this.chatsService.sendMessage(conversationId, userId, content);
  }
}