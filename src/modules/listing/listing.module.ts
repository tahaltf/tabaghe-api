// src/modules/listing/listing.module.ts
import {Module} from '@nestjs/common';
import {ListingService} from './listing.service';
import {ListingController} from './listing.controller';
import {PrismaModule} from "../../infrastructure/prisma/prisma.module";
import {QuotaModule} from "../quota/quota.module";
import {ListingSearchController} from "./listing-search.controller";
import {PrismaService} from "../../infrastructure/prisma/prisma.service";
import {ListingSearchService} from "./listing-search.service";
import { AuctionModule } from "../auction/auction.module";

@Module({
  imports: [PrismaModule, QuotaModule , AuctionModule],
  controllers: [ListingController, ListingSearchController],
  providers: [ListingService, ListingSearchService,
    PrismaService,],
})
export class ListingModule {}
