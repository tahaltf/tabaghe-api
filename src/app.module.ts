import { MiddlewareConsumer, Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { ScheduleModule } from '@nestjs/schedule';
import { ThrottlerModule, ThrottlerGuard } from '@nestjs/throttler';
import { APP_GUARD } from '@nestjs/core';
import { EventEmitterModule } from '@nestjs/event-emitter';
import { ServeStaticModule } from '@nestjs/serve-static';
import { join } from 'path';

// Infrastructure
import { PrismaModule } from './infrastructure/prisma/prisma.module';

// Common / Shared
import { RequestLoggerMiddleware } from './common/middleware/request-logger.middleware';
import { CommonModuleModule } from './common-module/common-module.module'; // بعداً اسم این پوشه رو به common تغییر میدیم

// Business Modules
import { WalletModule } from './modules/wallet/wallet.module';
import { UsersModule } from './modules/users/users.module';
import { AuthModule } from './modules/auth/auth.module';
import { ListingModule } from './modules/listing/listing.module';
import { PlansModule } from './modules/plans/plans.module';
import { QuotaModule } from './modules/quota/quota.module';
import { AuctionModule } from './modules/auction/auction.module';
import { NotificationModule } from './modules/notification/notification.module';
import { ExchangeModule } from './modules/exchange/exchange.module';
import { RepairModule } from './modules/repair/repair.module';
import { SupportModule } from './modules/support/support.module';
import { ChatsModule } from './modules/chats/chats.module';
import { OrdersModule } from './modules/orders/orders.module';
import { AddressModule } from './modules/address/address.module';
import { HealthModule } from './modules/health/health.module';
import { ReviewsModule } from "./modules/reviews/reviews.module"; // 👈 باید ماژول هلث داشته باشی، نه فقط کنترلر

@Module({
  imports: [
    // 1. Global Configurations
    ConfigModule.forRoot({ isGlobal: true }),
    ServeStaticModule.forRoot({
      rootPath: join(process.cwd(), 'uploads'),
      serveRoot: '/uploads',
      serveStaticOptions: { index: false },
    }),
    ScheduleModule.forRoot(),
    EventEmitterModule.forRoot(),
    ThrottlerModule.forRoot([
      {
        ttl: 60_000,
        limit: 100,
      },
    ]),

    // 2. Infrastructure
    PrismaModule,

    // 3. Shared/Common
    CommonModuleModule,

    // 4. Business Domains
    HealthModule, // کنترلر Health باید داخل این ماژول رجیستر شده باشد
    UsersModule,
    AuthModule,
    WalletModule, // کنترلر Wallet فقط باید داخل این ماژول رجیستر شده باشد
    ListingModule,
    PlansModule,
    QuotaModule,
    AuctionModule,
    ExchangeModule,
    RepairModule,
    NotificationModule,
    SupportModule,
    ChatsModule,
    OrdersModule,
    AddressModule,
    ReviewsModule,
  ],
  controllers: [], // 👈 باید کاملاً خالی باشد. کنترلرها متعلق به ماژول‌های خودشان هستند
  providers: [
    {
      provide: APP_GUARD,
      useClass: ThrottlerGuard, // 👈 فعال‌سازی واقعی محدودیت ریکوئست‌ها
    },
  ],
})
export class AppModule {
  configure(consumer: MiddlewareConsumer) {
    consumer.apply(RequestLoggerMiddleware).forRoutes('*');
  }
}
