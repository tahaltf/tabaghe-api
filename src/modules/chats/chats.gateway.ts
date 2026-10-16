import {
  WebSocketGateway,
  SubscribeMessage,
  MessageBody,
  ConnectedSocket,
  WebSocketServer,
  OnGatewayConnection,
  OnGatewayDisconnect,
  WsException,
} from '@nestjs/websockets';
import { Server, Socket } from 'socket.io';
import { ChatsService } from './chats.service';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import { websocketCorsOptions } from '../../config/cors-origins.util';
import { resolveJwtAccessSecret } from '../../config/jwt-secrets.util';
import { stripAllHtml } from '../../common/sanitize/html-sanitizer.util';

const MAX_CHAT_CONTENT_LENGTH = 4000;
const CHAT_SEND_WINDOW_MS = 10_000;
const CHAT_SEND_MAX_PER_WINDOW = 20;

@WebSocketGateway({ cors: websocketCorsOptions(), namespace: '/chat' })
export class ChatsGateway implements OnGatewayConnection, OnGatewayDisconnect {
  @WebSocketServer()
  server: Server;

  /** Simple per-socket send throttle (in-memory). */
  private readonly sendBuckets = new Map<string, { count: number; resetAt: number }>();

  constructor(
    private readonly chatsService: ChatsService,
    private readonly jwtService: JwtService,
    private readonly configService: ConfigService,
  ) {}

  // احراز هویت سوکت با توکن JWT
  async handleConnection(client: Socket) {
    try {
      const token =
        client.handshake.auth.token?.split(' ')[1] ||
        client.handshake.headers.authorization?.split(' ')[1];
      if (!token) return client.disconnect();

      const payload = this.jwtService.verify(token, {
        secret: resolveJwtAccessSecret(this.configService),
      });

      const userId = payload.sub;
      client.data.userId = userId;

      // کاربر را به اتاقی با نام ID خودش اضافه می‌کنیم تا پیام‌های خصوصی را دریافت کند
      client.join(userId);
    } catch {
      client.disconnect();
    }
  }

  handleDisconnect(client: Socket) {
    this.sendBuckets.delete(client.id);
  }

  @SubscribeMessage('sendMessage')
  async handleMessage(
    @ConnectedSocket() client: Socket,
    @MessageBody()
    payload: { conversationId: string; content: string; receiverId: string },
  ) {
    const senderId = client.data.userId as string | undefined;
    if (!senderId) {
      throw new WsException('Unauthorized');
    }

    if (!this.allowSend(client.id)) {
      throw new WsException('Too many messages');
    }

    const conversationId =
      typeof payload?.conversationId === 'string'
        ? payload.conversationId.trim()
        : '';
    const receiverId =
      typeof payload?.receiverId === 'string' ? payload.receiverId.trim() : '';
    const rawContent =
      typeof payload?.content === 'string' ? payload.content : '';

    if (!conversationId || !receiverId) {
      throw new WsException('Invalid payload');
    }

    const content = stripAllHtml(rawContent).trim().slice(0, MAX_CHAT_CONTENT_LENGTH);
    if (!content) {
      throw new WsException('Empty message');
    }

    // ۱. ذخیره پیام در دیتابیس
    const message = await this.chatsService.sendMessage(
      conversationId,
      senderId,
      content,
    );

    // ۲. ارسال پیام به صورت لحظه‌ای به گیرنده
    this.server.to(receiverId).emit('newMessage', message);

    // ۳. ارسال تاییدیه به فرستنده برای آپدیت تیکت در UI
    this.server.to(senderId).emit('newMessage', message);

    return message;
  }

  private allowSend(socketId: string): boolean {
    const now = Date.now();
    const bucket = this.sendBuckets.get(socketId);
    if (!bucket || now >= bucket.resetAt) {
      this.sendBuckets.set(socketId, {
        count: 1,
        resetAt: now + CHAT_SEND_WINDOW_MS,
      });
      return true;
    }
    if (bucket.count >= CHAT_SEND_MAX_PER_WINDOW) return false;
    bucket.count += 1;
    return true;
  }
}
