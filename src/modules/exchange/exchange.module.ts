import { Module } from '@nestjs/common';
import { ExchangeService } from './exchange.service';
import { ExchangeController } from './exchange.controller';
import { PrismaModule } from '../../infrastructure/prisma/prisma.module';
import { WalletModule } from "../wallet/wallet.module";

@Module({
    imports: [PrismaModule , WalletModule],
    controllers: [ExchangeController],
    exports: [ExchangeService], // 👈 این خط حتماً باید باشه
    providers: [ExchangeService],
})
export class ExchangeModule {}
