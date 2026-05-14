import {
  WebSocketGateway,
  SubscribeMessage,
  MessageBody,
  ConnectedSocket,
  WebSocketServer,
  OnGatewayConnection,
  OnGatewayDisconnect,
} from '@nestjs/websockets';
import { Server, Socket } from 'socket.io';
import { ChatsService } from './chats.service';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';

@WebSocketGateway({ cors: { origin: '*' }, namespace: '/chat' })
export class ChatsGateway implements OnGatewayConnection, OnGatewayDisconnect {
  @WebSocketServer()
  server: Server;

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
        secret: this.configService.get<string>('JWT_SECRET'),
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
    void client;
  }

  @SubscribeMessage('sendMessage')
  async handleMessage(
    @ConnectedSocket() client: Socket,
    @MessageBody()
    payload: { conversationId: string; content: string; receiverId: string },
  ) {
    const senderId = client.data.userId;

    // ۱. ذخیره پیام در دیتابیس
    const message = await this.chatsService.sendMessage(
      payload.conversationId,
      senderId,
      payload.content,
    );

    // ۲. ارسال پیام به صورت لحظه‌ای به گیرنده
    this.server.to(payload.receiverId).emit('newMessage', message);

    // ۳. ارسال تاییدیه به فرستنده برای آپدیت تیکت در UI
    this.server.to(senderId).emit('newMessage', message);

    return message;
  }
}
