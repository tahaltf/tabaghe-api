import { existsSync } from 'fs';
import { MiddlewareConsumer, Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { ScheduleModule } from '@nestjs/schedule';
import { ThrottlerModule, ThrottlerGuard } from '@nestjs/throttler';
import { ThrottlerStorageRedisService } from '@nest-lab/throttler-storage-redis';
import { APP_FILTER, APP_GUARD, APP_INTERCEPTOR } from '@nestjs/core';
import { EventEmitterModule } from '@nestjs/event-emitter';
import { ServeStaticModule } from '@nestjs/serve-static';
import { join } from 'path';

function loadEnvFilePaths(): string[] {
  const root = process.cwd();
  const nodeEnv = process.env.NODE_ENV || 'development';
  const paths = [
    join(root, `.env.${nodeEnv}`),
    join(root, `.env.${nodeEnv}.local`),
    join(root, '.env'),
  ];
  return paths.filter((p) => existsSync(p));
}

// Infrastructure
import { PrismaModule } from './infrastructure/prisma/prisma.module';
import { AppCacheModule } from './infrastructure/cache/cache.module';
import { RedisService } from './infrastructure/cache/redis.service';

// Common / Shared
import { RequestLoggerMiddleware } from './common/middleware/request-logger.middleware';
import { AllExceptionsFilter } from './common/filters/all-exceptions.filter';
import { ResponseEnvelopeInterceptor } from './common/interceptors/response-envelope.interceptor';
import { CacheControlInterceptor } from './common/interceptors/cache-control.interceptor';
import { CommonModuleModule } from './common-module/common-module.module'; // بعداً اسم این پوشه رو به common تغییر میدیم
import { SettingsModule } from './shared/settings/settings.module';

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
import { ReviewsModule } from './modules/reviews/reviews.module'; // 👈 باید ماژول هلث داشته باشی، نه فقط کنترلر
import { AdminModule } from './modules/admin/admin.module';
import { PaymentsModule } from './modules/payments/payments.module';
import { SitemapModule } from './modules/sitemap/sitemap.module';
import { TrackingModule } from './modules/tracking/tracking.module';
import { WordPressIntegrationModule } from './modules/wordpress-integration/wordpress-integration.module';

import { AppController } from './app.controller';
import { AppService } from './app.service';

@Module({
  imports: [
    // 1. Global Configurations
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: loadEnvFilePaths(),
    }),
    ServeStaticModule.forRoot({
      rootPath: join(process.cwd(), 'uploads'),
      serveRoot: '/uploads',
      serveStaticOptions: { index: false },
    }),
    ScheduleModule.forRoot(),
    EventEmitterModule.forRoot(),
    AppCacheModule,
    ThrottlerModule.forRootAsync({
      imports: [AppCacheModule],
      inject: [RedisService],
      useFactory: (redis: RedisService) => {
        const client = redis.getClient();
        return {
          throttlers: [{ ttl: 60_000, limit: 100 }],
          ...(client
            ? { storage: new ThrottlerStorageRedisService(client) }
            : {}),
        };
      },
    }),

    // 2. Infrastructure
    PrismaModule,

    // 3. Shared/Common
    CommonModuleModule,
    SettingsModule,

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
    AdminModule,
    PaymentsModule,
    SitemapModule,
    TrackingModule,
    WordPressIntegrationModule,
  ],
  controllers: [AppController],
  providers: [
    AppService,
    {
      provide: APP_GUARD,
      useClass: ThrottlerGuard, // 👈 فعال‌سازی واقعی محدودیت ریکوئست‌ها
    },
    {
      provide: APP_FILTER,
      useClass: AllExceptionsFilter,
    },
    {
      provide: APP_INTERCEPTOR,
      useClass: ResponseEnvelopeInterceptor,
    },
    {
      provide: APP_INTERCEPTOR,
      useClass: CacheControlInterceptor,
    },
  ],
})
export class AppModule {
  configure(consumer: MiddlewareConsumer) {
    consumer.apply(RequestLoggerMiddleware).forRoutes('*');
  }
}
