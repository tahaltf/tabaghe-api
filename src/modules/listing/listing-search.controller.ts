import { Controller, Get, Query } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { ListingSearchService } from './listing-search.service';
import { SearchListingsDto } from './dto/search-listings.dto';

@Controller('listings')
export class ListingSearchController {
  constructor(private readonly listingSearchService: ListingSearchService) {}

  @Get('search')
  @Throttle({ default: { limit: 40, ttl: 60_000 } })
  search(@Query() query: SearchListingsDto) {
    return this.listingSearchService.search(query);
  }
}
