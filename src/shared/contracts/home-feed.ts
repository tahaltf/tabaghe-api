import type { ListingListItem } from '../../modules/listing/services/listing-query.service';

export type HomeFeedResponse = {
  auction: ListingListItem[];
  direct: ListingListItem[];
  exchange: ListingListItem[];
  stats: {
    total: number;
    auctions: number;
  };
};
