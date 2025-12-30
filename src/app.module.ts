import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { PrismaModule } from './prisma/prisma.module';
import { WalletModule } from './modules/wallet/wallet.module';
import { UsersModule } from './modules/users/users.module';
import { AuthModule } from './modules/auth/auth.module';
import { ListingModule } from './modules/listing/listing.module';
import { PlansModule } from './modules/plans/plans.module';
import { QuotaModule } from './modules/quota/quota.module';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    PrismaModule,
    UsersModule,
    AuthModule,
    WalletModule,
    ListingModule,
    PlansModule,
    QuotaModule,

  ],
})
export class AppModule {}
