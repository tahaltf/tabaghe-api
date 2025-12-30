// src/modules/listing/listing.module.ts
import {Module} from '@nestjs/common';
import {ListingService} from './listing.service';
import {ListingController} from './listing.controller';
import {PrismaModule} from "../../prisma/prisma.module";
import {QuotaModule} from "../quota/quota.module";

@Module({
  imports: [PrismaModule, QuotaModule],
  controllers: [ListingController],
  providers: [ListingService],
})
export class ListingModule {}
