import { Module } from '@nestjs/common';
import { ChatsService } from './chats.service';
import { ChatsController } from './chats.controller';
import { ChatsGateway } from './chats.gateway'; // 👈 اضافه شد
import { JwtModule } from '@nestjs/jwt'; // 👈 اضافه شد برای احراز هویت سوکت

@Module({
  imports: [JwtModule.register({})],
  controllers: [ChatsController],
  providers: [ChatsService, ChatsGateway], // 👈 گیت‌وی به پروایدرها اضافه شد
})
export class ChatsModule {}
