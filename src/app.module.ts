import {MiddlewareConsumer, Module} from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { PrismaModule } from './prisma/prisma.module';
import { WalletModule } from './modules/wallet/wallet.module';
import { UsersModule } from './modules/users/users.module';
import { AuthModule } from './modules/auth/auth.module';
import { ListingModule } from './modules/listing/listing.module';
import { PlansModule } from './modules/plans/plans.module';
import { QuotaModule } from './modules/quota/quota.module';
import { AuctionModule } from './modules/auction/auction.module';
import {ScheduleModule} from "@nestjs/schedule";
import {ThrottlerModule} from "@nestjs/throttler";
import { EventEmitterModule } from '@nestjs/event-emitter';
import {NotificationModule} from "./modules/notification/notification.module";
import {HealthController} from "./health/health.controller";
import {PrismaService} from "./prisma/prisma.service";
import {RequestLoggerMiddleware} from "./common/middleware/request-logger.middleware";

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    ScheduleModule.forRoot(),
    EventEmitterModule.forRoot(),
    ThrottlerModule.forRoot([
      {
        ttl: 60_000, // ⏱️ milliseconds
        limit: 100,
      },
    ]),
    PrismaModule,
    UsersModule,
    AuthModule,
    WalletModule,
    ListingModule,
    PlansModule,
    QuotaModule,
    AuctionModule,
    NotificationModule,

  ],
  controllers: [
    HealthController,
    // ... بقیه controllerها
  ],
  providers: [
    PrismaService,
    // ...
  ],
})
export class AppModule {
  configure(consumer: MiddlewareConsumer) {
    consumer.apply(RequestLoggerMiddleware).forRoutes('*');
  }
}
