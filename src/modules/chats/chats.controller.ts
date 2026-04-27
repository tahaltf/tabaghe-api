import { Controller, Get, Post, Body, Param, UseGuards } from '@nestjs/common';
import { ChatsService } from './chats.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { AuthenticatedUser } from '../../shared/contracts/auth';

@UseGuards(JwtAuthGuard)
@Controller('chat')
export class ChatsController {
  constructor(private readonly chatsService: ChatsService) {}

  @Post('initiate')
  async initiateChat(
    @CurrentUser() user: AuthenticatedUser,
    @Body('listingId') listingId: string,
    @Body('targetUserId') targetUserId?: string,
  ) {
    return this.chatsService.initiateChat(user.id, listingId, targetUserId);
  }

  @Get('conversations')
  async getMyConversations(@CurrentUser() user: AuthenticatedUser) {
    return this.chatsService.getMyConversations(user.id);
  }

  @Get('messages/:id')
  async getMessages(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') chatId: string,
  ) {
    return this.chatsService.getMessages(chatId, user.id);
  }

  @Post('message')
  async sendMessage(
    @CurrentUser() user: AuthenticatedUser,
    @Body() body: { conversationId?: string; chatId?: string; content?: string },
  ) {
    const conversationId = body.conversationId ?? body.chatId;
    return this.chatsService.sendMessage(conversationId ?? '', user.id, body.content ?? '');
  }

  @Post('conversations/:id/read')
  async markRead(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') chatId: string,
  ) {
    return this.chatsService.markConversationRead(chatId, user.id);
  }
}