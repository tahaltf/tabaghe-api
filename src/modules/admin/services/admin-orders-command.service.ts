import { Injectable } from '@nestjs/common';
import { OrderStatus } from '@prisma/client';
import {
  FinalizeExchangeHubInspectionDto,
  RejectExchangeFakeShipmentDto,
  ResolveOrderEscrowDto,
  SetExchangeHubReceiptDto,
  SetHubShippingCodesDto,
  SetParticipantShippingDto,
} from '../dto/admin-order.dto';
import { AdminOrdersStatusService } from './orders-command/admin-orders-status.service';
import { AdminOrdersHubService } from './orders-command/admin-orders-hub.service';
import { AdminOrdersInspectionService } from './orders-command/admin-orders-inspection.service';
import { AdminOrdersEscrowService } from './orders-command/admin-orders-escrow.service';

/**
 * Backward-compatible facade. Prefer injecting specialized services directly.
 */
@Injectable()
export class AdminOrdersCommandService {
  constructor(
    private readonly status: AdminOrdersStatusService,
    private readonly hub: AdminOrdersHubService,
    private readonly inspection: AdminOrdersInspectionService,
    private readonly escrow: AdminOrdersEscrowService,
  ) {}

  repairBuyerRefundForCancelledOrder(...args: Parameters<AdminOrdersStatusService['repairBuyerRefundForCancelledOrder']>) {
    return this.status.repairBuyerRefundForCancelledOrder(...args);
  }

  repairMissingPurchaseEscrow(...args: Parameters<AdminOrdersStatusService['repairMissingPurchaseEscrow']>) {
    return this.status.repairMissingPurchaseEscrow(...args);
  }

  listMissingPurchaseEscrow(...args: Parameters<AdminOrdersStatusService['listMissingPurchaseEscrow']>) {
    return this.status.listMissingPurchaseEscrow(...args);
  }

  repairAllMissingPurchaseEscrow(...args: Parameters<AdminOrdersStatusService['repairAllMissingPurchaseEscrow']>) {
    return this.status.repairAllMissingPurchaseEscrow(...args);
  }

  updateStatus(...args: Parameters<AdminOrdersStatusService['updateStatus']>) {
    return this.status.updateStatus(...args);
  }

  setHubShippingCodes(...args: Parameters<AdminOrdersHubService['setHubShippingCodes']>) {
    return this.hub.setHubShippingCodes(...args);
  }

  setTrackingCode(...args: Parameters<AdminOrdersHubService['setTrackingCode']>) {
    return this.hub.setTrackingCode(...args);
  }

  setParticipantShipping(...args: Parameters<AdminOrdersHubService['setParticipantShipping']>) {
    return this.hub.setParticipantShipping(...args);
  }

  setExchangeHubReceipt(...args: Parameters<AdminOrdersHubService['setExchangeHubReceipt']>) {
    return this.hub.setExchangeHubReceipt(...args);
  }

  finalizeExchangeHubInspection(...args: Parameters<AdminOrdersInspectionService['finalizeExchangeHubInspection']>) {
    return this.inspection.finalizeExchangeHubInspection(...args);
  }

  resolveEscrow(...args: Parameters<AdminOrdersEscrowService['resolveEscrow']>) {
    return this.escrow.resolveEscrow(...args);
  }

  rejectExchangeFakeShipment(...args: Parameters<AdminOrdersInspectionService['rejectExchangeFakeShipment']>) {
    return this.inspection.rejectExchangeFakeShipment(...args);
  }
}
