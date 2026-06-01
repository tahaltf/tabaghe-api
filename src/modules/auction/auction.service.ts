import { Injectable } from '@nestjs/common';
import { AuctionBiddingService } from './services/auction-bidding.service';
import { AuctionSettlementService } from './services/auction-settlement.service';
import { AuctionQueryService } from './services/auction-query.service';

/**
 * Backward-compatible facade. Prefer injecting specialized services directly.
 */
@Injectable()
export class AuctionService {
  constructor(
    private readonly bidding: AuctionBiddingService,
    private readonly settlement: AuctionSettlementService,
    private readonly query: AuctionQueryService,
  ) {}

  placeBid(...args: Parameters<AuctionBiddingService['placeBid']>) {
    return this.bidding.placeBid(...args);
  }

  finalizeAuction(...args: Parameters<AuctionSettlementService['finalizeAuction']>) {
    return this.settlement.finalizeAuction(...args);
  }

  payAuction(...args: Parameters<AuctionSettlementService['payAuction']>) {
    return this.settlement.payAuction(...args);
  }

  checkUnpaidAuctions(...args: Parameters<AuctionSettlementService['checkUnpaidAuctions']>) {
    return this.settlement.checkUnpaidAuctions(...args);
  }

  penalizeWinner(...args: Parameters<AuctionSettlementService['penalizeWinner']>) {
    return this.settlement.penalizeWinner(...args);
  }

  declineSecondChance(...args: Parameters<AuctionSettlementService['declineSecondChance']>) {
    return this.settlement.declineSecondChance(...args);
  }

  cancelBid(...args: Parameters<AuctionBiddingService['cancelBid']>) {
    return this.bidding.cancelBid(...args);
  }

  buyNow(...args: Parameters<AuctionBiddingService['buyNow']>) {
    return this.bidding.buyNow(...args);
  }

  getAuctionState(...args: Parameters<AuctionQueryService['getAuctionState']>) {
    return this.query.getAuctionState(...args);
  }

  getAuctionBids(...args: Parameters<AuctionQueryService['getAuctionBids']>) {
    return this.query.getAuctionBids(...args);
  }

  getAuctionCheckoutData(...args: Parameters<AuctionQueryService['getAuctionCheckoutData']>) {
    return this.query.getAuctionCheckoutData(...args);
  }

  forcePenalizeWinner(...args: Parameters<AuctionSettlementService['forcePenalizeWinner']>) {
    return this.settlement.forcePenalizeWinner(...args);
  }

  forceRefundAuction(...args: Parameters<AuctionSettlementService['forceRefundAuction']>) {
    return this.settlement.forceRefundAuction(...args);
  }

  forceSettleAuction(...args: Parameters<AuctionSettlementService['forceSettleAuction']>) {
    return this.settlement.forceSettleAuction(...args);
  }
}
