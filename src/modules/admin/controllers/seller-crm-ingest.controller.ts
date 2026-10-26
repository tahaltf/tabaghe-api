import { Body, Controller, Post, UseGuards } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { AdminSellerCrmService } from '../services/admin-seller-crm.service';
import { AdminIngestDivarSellerLeadDto } from '../dto/admin-seller-crm.dto';
import { SellerCrmIngestGuard } from '../guards/seller-crm-ingest.guard';

/**
 * Endpoint برای کرالر دیوار — ثبت خودکار لید.
 * Auth: header `X-Seller-Crm-Ingest-Key` یا `Authorization: Bearer <SELLER_CRM_INGEST_SECRET>`
 */
@Controller('integrations/seller-crm')
@UseGuards(SellerCrmIngestGuard)
export class SellerCrmIngestController {
  constructor(private readonly service: AdminSellerCrmService) {}

  @Post('divar-leads')
  @Throttle({ default: { limit: 120, ttl: 60_000 } })
  ingestDivar(@Body() dto: AdminIngestDivarSellerLeadDto) {
    return this.service.ingestDivarLead(dto);
  }
}
