import { Module } from '@nestjs/common';
import { PrismaModule } from '../../infrastructure/prisma/prisma.module';
import { PurchaseOfferController } from './purchase-offer.controller';
import { PurchaseOfferService } from './purchase-offer.service';
import { PurchaseOfferScheduler } from './purchase-offer.scheduler';

@Module({
  imports: [PrismaModule],
  controllers: [PurchaseOfferController],
  providers: [PurchaseOfferService, PurchaseOfferScheduler],
  exports: [PurchaseOfferService],
})
export class PurchaseOfferModule {}
