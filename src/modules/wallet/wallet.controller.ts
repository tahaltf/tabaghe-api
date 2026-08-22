import {
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Post,
  Query,
  Req,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import type { Express } from 'express';
import { UserRole } from '@prisma/client';
import { WalletService } from './wallet.service';
import { extractClientIp } from '../../common/http/client-ip.util';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { PermissionsGuard } from '../auth/guards/permissions.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { RequirePermission } from '../auth/decorators/require-permission.decorator';
import { UserPanelAccessGuard } from '../auth/guards/user-panel-access.guard';
import { RequirePanelAccess } from '../auth/decorators/require-panel-access.decorator';
import { depositReceiptMulterOptions } from '../../common/upload/deposit-receipt-upload.config';

@Controller('wallet')
@UseGuards(JwtAuthGuard)
export class WalletController {
  constructor(private readonly walletService: WalletService) {}

  // ==========================================
  // USER ROUTES
  // ==========================================

  @Get('me')
  async getMyWallet(@Req() req: any) {
    return this.walletService.getWalletByUserId(req.user.id);
  }

  @Get('transactions')
  async getMyWalletTransactions(
    @Req() req: any,
    @Query('page') page?: string,
    @Query('pageSize') pageSize?: string,
    @Query('filter') filter?: 'ALL' | 'INCOME' | 'EXPENSE' | 'BLOCKED' | 'PENDING',
  ) {
    return this.walletService.getUserWalletTransactions(req.user.id, {
      page: page ? Number(page) : undefined,
      pageSize: pageSize ? Number(pageSize) : undefined,
      filter: filter ?? 'ALL',
    });
  }

  @Get('commission-report')
  async getCommissionReport(
    @Req() req: any,
    @Query('month') month?: string,
  ) {
    return this.walletService.getCommissionReport(req.user.id, { month });
  }

  /**
   * Instant online charge (payment-gateway callback). Kept for backward
   * compatibility – no admin approval.
   */
  @Post('deposit')
  async deposit(@Req() req: any, @Body() body: { amount: number }) {
    return this.walletService.deposit(req.user.id, body.amount);
  }

  /**
   * Manual (card-to-card / bank transfer) charge request. Creates a
   * PENDING deposit that is reviewed by an admin via the admin panel.
   */
  @Post('deposit-request')
  @UseInterceptors(FileInterceptor('receiptImage', depositReceiptMulterOptions))
  async requestDeposit(
    @Req() req: any,
    @UploadedFile() file: Express.Multer.File | undefined,
    @Body()
    body: { amount: number; trackingCode?: string; description?: string },
  ) {
    return this.walletService.requestDeposit(req.user.id, {
      amount: body.amount,
      receiptImage: file ? `deposit-receipts/${file.filename}` : null,
      trackingCode: body.trackingCode ?? null,
      description: body.description ?? null,
    });
  }

  @Post('withdraw/request-otp')
  @UseGuards(UserPanelAccessGuard)
  @RequirePanelAccess('dashboard.wallet.withdraw')
  async requestWithdrawOtp(@Req() req: any) {
    return this.walletService.requestWithdrawOtp(req.user.id);
  }

  @Post('withdraw')
  @UseGuards(UserPanelAccessGuard)
  @RequirePanelAccess('dashboard.wallet.withdraw')
  async requestWithdraw(
    @Req() req: any,
    @Body()
    body: {
      amount: number;
      shaba: string;
      card: string;
      ownerName: string;
      otpCode: string;
    },
  ) {
    return this.walletService.requestWithdraw(req.user.id, body, extractClientIp(req));
  }

  // ==========================================
  // ADMIN ROUTES (kept here for backward compat)
  // ==========================================

  @Get('admin/withdraw-requests')
  @UseGuards(RolesGuard, PermissionsGuard)
  @Roles(UserRole.ADMIN)
  @RequirePermission('wallet_requests.view')
  async getWithdrawRequests(
    @Query('status') status?: 'PENDING' | 'APPROVED' | 'REJECTED' | 'ALL',
    @Query('page') page?: string,
    @Query('pageSize') pageSize?: string,
    @Query('search') search?: string,
  ) {
    return this.walletService.getWithdrawRequestsAdmin({
      status,
      page: page ? Number(page) : 1,
      pageSize: pageSize ? Number(pageSize) : 20,
      search,
    });
  }

  @Patch('admin/process-withdraw/:id')
  @UseGuards(RolesGuard, PermissionsGuard)
  @Roles(UserRole.ADMIN)
  @RequirePermission('wallet_requests.approve')
  async processWithdraw(
    @Param('id') id: string,
    @Body() body: { action: 'APPROVE' | 'REJECT'; adminNote?: string },
  ) {
    return this.walletService.processWithdraw(id, body.action, body.adminNote);
  }

  @Get('admin/deposit-requests')
  @UseGuards(RolesGuard, PermissionsGuard)
  @Roles(UserRole.ADMIN)
  @RequirePermission('wallet_requests.view')
  async getDepositRequests(
    @Query('status') status?: 'PENDING' | 'APPROVED' | 'REJECTED' | 'ALL',
    @Query('page') page?: string,
    @Query('pageSize') pageSize?: string,
    @Query('search') search?: string,
  ) {
    return this.walletService.getDepositRequestsAdmin({
      status,
      page: page ? Number(page) : 1,
      pageSize: pageSize ? Number(pageSize) : 20,
      search,
    });
  }

  @Patch('admin/process-deposit/:id')
  @UseGuards(RolesGuard, PermissionsGuard)
  @Roles(UserRole.ADMIN)
  @RequirePermission('wallet_requests.approve')
  async processDeposit(
    @Param('id') id: string,
    @Body() body: { action: 'APPROVE' | 'REJECT'; adminNote?: string },
  ) {
    return this.walletService.processDeposit(id, body.action, body.adminNote);
  }
}
