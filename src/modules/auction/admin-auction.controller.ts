import {
  BadRequestException,
  Controller,
  Headers,
  Param,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import { AuctionService } from './auction.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { PermissionsGuard } from '../auth/guards/permissions.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { RequirePermission } from '../auth/decorators/require-permission.decorator';
import { UserRole } from '@prisma/client';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { randomUUID } from 'crypto';

@Controller('admin/auctions')
@UseGuards(JwtAuthGuard, RolesGuard, PermissionsGuard)
@Roles(UserRole.ADMIN)
@RequirePermission('auction_ops.view')
export class AdminAuctionController {
  constructor(
    private readonly auctionService: AuctionService,
    private readonly prisma: PrismaService,
  ) {}

  private async executeWithDualApproval(params: {
    action: 'FORCE_SETTLE' | 'FORCE_PENALIZE' | 'FORCE_REFUND';
    listingId: string;
    adminId: string;
    approvalToken?: string;
    execute: () => Promise<unknown>;
  }) {
    const { action, listingId, adminId, approvalToken, execute } = params;
    const key = `AUCTION_ADMIN_ACTION_${action}_${listingId}`;
    const now = Date.now();
    const expiresAt = new Date(now + 15 * 60 * 1000).toISOString();
    const current = await this.prisma.systemSetting.findUnique({
      where: { key },
      select: { value: true },
    });
    if (!current) {
      const token = randomUUID();
      await this.prisma.systemSetting.create({
        data: {
          key,
          value: JSON.stringify({
            requestedBy: adminId,
            token,
            createdAt: new Date(now).toISOString(),
            expiresAt,
          }),
          description: 'Dual-control pending admin action for auction',
        },
      });
      return {
        requiresSecondApproval: true,
        action,
        listingId,
        approvalToken: token,
        expiresAt,
      };
    }
    let payload: any = null;
    try {
      payload = JSON.parse(current.value);
    } catch {
      payload = null;
    }
    if (!payload?.token || !payload?.requestedBy) {
      throw new BadRequestException('درخواست تایید نامعتبر است');
    }
    if (!approvalToken || approvalToken !== payload.token) {
      throw new BadRequestException('Approval token نامعتبر است');
    }
    if (payload.requestedBy === adminId) {
      throw new BadRequestException(
        'تایید دوم باید توسط ادمین دیگری انجام شود',
      );
    }
    if (payload.expiresAt && new Date(payload.expiresAt).getTime() < now) {
      throw new BadRequestException('مهلت approval token به پایان رسیده است');
    }
    const result = await execute();
    await this.prisma.systemSetting.deleteMany({ where: { key } });
    return { requiresSecondApproval: false, result };
  }

  // -----------------------------------
  // Force settle (admin override)
  // -----------------------------------
  @Post(':listingId/force-settle')
  @RequirePermission('auction_ops.update')
  async forceSettle(
    @Param('listingId') listingId: string,
    @Req() req: any,
    @Headers('x-approval-token') approvalToken?: string,
  ) {
    return this.executeWithDualApproval({
      action: 'FORCE_SETTLE',
      listingId,
      adminId: req.user.id,
      approvalToken,
      execute: () => this.auctionService.forceSettleAuction(listingId),
    });
  }

  // -----------------------------------
  // Force penalize
  // -----------------------------------
  @Post(':listingId/force-penalize')
  @RequirePermission('auction_ops.update')
  async forcePenalize(
    @Param('listingId') listingId: string,
    @Req() req: any,
    @Headers('x-approval-token') approvalToken?: string,
  ) {
    return this.executeWithDualApproval({
      action: 'FORCE_PENALIZE',
      listingId,
      adminId: req.user.id,
      approvalToken,
      execute: () => this.auctionService.forcePenalizeWinner(listingId),
    });
  }

  // -----------------------------------
  // Force refund
  // -----------------------------------
  @Post(':listingId/refund')
  @RequirePermission('auction_ops.update')
  async refund(
    @Param('listingId') listingId: string,
    @Req() req: any,
    @Headers('x-approval-token') approvalToken?: string,
  ) {
    return this.executeWithDualApproval({
      action: 'FORCE_REFUND',
      listingId,
      adminId: req.user.id,
      approvalToken,
      execute: () => this.auctionService.forceRefundAuction(listingId),
    });
  }
}
