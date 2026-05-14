import { Controller, Get, Query } from '@nestjs/common';
import { ListingSearchService } from './listing-search.service';
import { SearchListingsDto } from './dto/search-listings.dto';

@Controller('listings')
export class ListingSearchController {
  constructor(private readonly listingSearchService: ListingSearchService) {}

  @Get('search')
  search(@Query() query: SearchListingsDto) {
    return this.listingSearchService.search(query);
  }
}
