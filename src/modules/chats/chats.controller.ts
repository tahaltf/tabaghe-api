import { Controller, Get, Post, Body, Param, Request, UseGuards } from '@nestjs/common';
import { ChatsService } from './chats.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';

@UseGuards(JwtAuthGuard)
@Controller('chat')
export class ChatsController {
  constructor(private readonly chatsService: ChatsService) {}

  @Post('initiate')
  async initiateChat(
    @Request() req: any,
    @Body('listingId') listingId: string,
    @Body('targetUserId') targetUserId?: string, // 👈 اضافه شد
  ) {
    // ✅ تغییر req.user.sub به req.user.id
    return this.chatsService.initiateChat(req.user.id, listingId , targetUserId);
  }

  @Get('conversations')
  async getMyConversations(@Request() req: any) {
    // ✅ اصلاح شد
    return this.chatsService.getMyConversations(req.user.id);
  }

  @Get('messages/:id')
  async getMessages(
    @Request() req: any,
    @Param('id') chatId: string,
  ) {
    // ✅ اصلاح شد
    return this.chatsService.getMessages(chatId, req.user.id);
  }

  @Post('message')
  async sendMessage(
    @Request() req: any,
    @Body('conversationId') conversationId: string,
    @Body('content') content: string,
  ) {
    // ✅ اصلاح شد
    return this.chatsService.sendMessage(conversationId, req.user.id, content);
  }
}