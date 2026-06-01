import { Injectable } from '@nestjs/common';
import { WalletQueryService } from './services/query/wallet-query.service';
import { WalletBlockService } from './services/block/wallet-block.service';
import { WalletEscrowService } from './services/escrow/wallet-escrow.service';
import { WalletRefundService } from './services/refund/wallet-refund.service';
import { WalletDepositWithdrawService } from './services/deposit-withdraw/wallet-deposit-withdraw.service';

export type { UserWalletTxFilter } from './wallet.constants';

/**
 * Backward-compatible facade. Prefer injecting specialized services directly.
 */
@Injectable()
export class WalletService {
  constructor(
    private readonly query: WalletQueryService,
    private readonly block: WalletBlockService,
    private readonly escrow: WalletEscrowService,
    private readonly refund: WalletRefundService,
    private readonly depositWithdraw: WalletDepositWithdrawService,
  ) {}

  getWalletByUserId(...args: Parameters<WalletQueryService['getWalletByUserId']>) {
    return this.query.getWalletByUserId(...args);
  }

  getUserWalletTransactions(...args: Parameters<WalletQueryService['getUserWalletTransactions']>) {
    return this.query.getUserWalletTransactions(...args);
  }

  blockAmount(...args: Parameters<WalletBlockService['blockAmount']>) {
    return this.block.blockAmount(...args);
  }

  getAuctionBidDepositScopedBlocked(...args: Parameters<WalletBlockService['getAuctionBidDepositScopedBlocked']>) {
    return this.block.getAuctionBidDepositScopedBlocked(...args);
  }

  unblockAmount(...args: Parameters<WalletBlockService['unblockAmount']>) {
    return this.block.unblockAmount(...args);
  }

  confiscateBlocked(...args: Parameters<WalletBlockService['confiscateBlocked']>) {
    return this.block.confiscateBlocked(...args);
  }

  payAuctionFinal(...args: Parameters<WalletEscrowService['payAuctionFinal']>) {
    return this.escrow.payAuctionFinal(...args);
  }

  settleAuctionGatewayPayment(...args: Parameters<WalletEscrowService['settleAuctionGatewayPayment']>) {
    return this.escrow.settleAuctionGatewayPayment(...args);
  }

  transferToEscrow(...args: Parameters<WalletEscrowService['transferToEscrow']>) {
    return this.escrow.transferToEscrow(...args);
  }

  creditExternalPaymentToEscrow(...args: Parameters<WalletEscrowService['creditExternalPaymentToEscrow']>) {
    return this.escrow.creditExternalPaymentToEscrow(...args);
  }

  resolveOrderScopedCap(...args: Parameters<WalletEscrowService['resolveOrderScopedCap']>) {
    return this.escrow.resolveOrderScopedCap(...args);
  }

  debitOrderScopedBlocked(...args: Parameters<WalletEscrowService['debitOrderScopedBlocked']>) {
    return this.escrow.debitOrderScopedBlocked(...args);
  }

  releaseEscrow(...args: Parameters<WalletEscrowService['releaseEscrow']>) {
    return this.escrow.releaseEscrow(...args);
  }

  linkEscrowDepositsToOrder(...args: Parameters<WalletEscrowService['linkEscrowDepositsToOrder']>) {
    return this.escrow.linkEscrowDepositsToOrder(...args);
  }

  getOrderScopedBlockedAmount(...args: Parameters<WalletEscrowService['getOrderScopedBlockedAmount']>) {
    return this.escrow.getOrderScopedBlockedAmount(...args);
  }

  refundDirectOrderEscrowOnCancel(...args: Parameters<WalletRefundService['refundDirectOrderEscrowOnCancel']>) {
    return this.refund.refundDirectOrderEscrowOnCancel(...args);
  }

  repairMissingDirectCancelRefund(...args: Parameters<WalletRefundService['repairMissingDirectCancelRefund']>) {
    return this.refund.repairMissingDirectCancelRefund(...args);
  }

  refundExchangeExtraOnCancel(...args: Parameters<WalletRefundService['refundExchangeExtraOnCancel']>) {
    return this.refund.refundExchangeExtraOnCancel(...args);
  }

  resolveExchangeParticipantPaidAmount(...args: Parameters<WalletRefundService['resolveExchangeParticipantPaidAmount']>) {
    return this.refund.resolveExchangeParticipantPaidAmount(...args);
  }

  refundExchangePaymentTimeoutOnCancel(...args: Parameters<WalletRefundService['refundExchangePaymentTimeoutOnCancel']>) {
    return this.refund.refundExchangePaymentTimeoutOnCancel(...args);
  }

  refundExchangeOneSideNoShipmentOnCancel(...args: Parameters<WalletRefundService['refundExchangeOneSideNoShipmentOnCancel']>) {
    return this.refund.refundExchangeOneSideNoShipmentOnCancel(...args);
  }

  refundExchangeBothNoShipmentOnCancel(...args: Parameters<WalletRefundService['refundExchangeBothNoShipmentOnCancel']>) {
    return this.refund.refundExchangeBothNoShipmentOnCancel(...args);
  }

  applyExchangeHubInspectionOutcomeRefunds(...args: Parameters<WalletRefundService['applyExchangeHubInspectionOutcomeRefunds']>) {
    return this.refund.applyExchangeHubInspectionOutcomeRefunds(...args);
  }

  deposit(...args: Parameters<WalletDepositWithdrawService['deposit']>) {
    return this.depositWithdraw.deposit(...args);
  }

  requestDeposit(...args: Parameters<WalletDepositWithdrawService['requestDeposit']>) {
    return this.depositWithdraw.requestDeposit(...args);
  }

  getDepositRequestsAdmin(...args: Parameters<WalletDepositWithdrawService['getDepositRequestsAdmin']>) {
    return this.depositWithdraw.getDepositRequestsAdmin(...args);
  }

  processDeposit(...args: Parameters<WalletDepositWithdrawService['processDeposit']>) {
    return this.depositWithdraw.processDeposit(...args);
  }

  requestWithdraw(...args: Parameters<WalletDepositWithdrawService['requestWithdraw']>) {
    return this.depositWithdraw.requestWithdraw(...args);
  }

  getWithdrawRequestsAdmin(...args: Parameters<WalletDepositWithdrawService['getWithdrawRequestsAdmin']>) {
    return this.depositWithdraw.getWithdrawRequestsAdmin(...args);
  }

  processWithdraw(...args: Parameters<WalletDepositWithdrawService['processWithdraw']>) {
    return this.depositWithdraw.processWithdraw(...args);
  }

  payFromAvailable(...args: Parameters<WalletEscrowService['payFromAvailable']>) {
    return this.escrow.payFromAvailable(...args);
  }
}
