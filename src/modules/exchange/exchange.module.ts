import { Module } from '@nestjs/common';
import { ExchangeService } from './exchange.service';
import { ExchangeController } from './exchange.controller';
import { PrismaModule } from '../../infrastructure/prisma/prisma.module';
import { WalletModule } from '../wallet/wallet.module';
import { UsersModule } from '../users/users.module';

@Module({
  imports: [PrismaModule, WalletModule, UsersModule],
  controllers: [ExchangeController],
  exports: [ExchangeService], // 👈 این خط حتماً باید باشه
  providers: [ExchangeService],
})
export class ExchangeModule {}
