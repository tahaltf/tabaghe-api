import {
    Body,
    Controller,
    Get,
    Post,
    Patch,
    Param,
    Req,
    UseGuards,
    ParseIntPipe,
} from '@nestjs/common';
import { WalletService } from './wallet.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { UserRole } from '@prisma/client';

@Controller('wallet')
@UseGuards(JwtAuthGuard)
export class WalletController {
    constructor(private readonly walletService: WalletService) {}

    // ==========================================
    // مسیرهای کاربر (User Routes)
    // ==========================================

    @Get('me')
    async getMyWallet(@Req() req: any) {
        return this.walletService.getWalletByUserId(req.user.id);
    }

    @Post('deposit')
    async deposit(@Req() req: any, @Body() body: { amount: number }) {
        return this.walletService.deposit(req.user.id, body.amount);
    }

    @Post('withdraw')
    async requestWithdraw(
      @Req() req: any,
      @Body()
        body: {
          amount: number;
          shaba: string;
          card: string;
          ownerName: string;
      },
    ) {
        return this.walletService.requestWithdraw(req.user.id, body);
    }

    // ==========================================
    // مسیرهای ادمین (Admin Routes)
    // ==========================================

    @Get('admin/withdraw-requests')
    @UseGuards(RolesGuard)
    @Roles(UserRole.ADMIN)
    async getWithdrawRequests() {
        return this.walletService.getWithdrawRequestsAdmin();
    }

    @Patch('admin/process-withdraw/:id')
    @UseGuards(RolesGuard)
    @Roles(UserRole.ADMIN)
    async processWithdraw(
      @Param('id') id: string,
      @Body() body: { action: 'APPROVE' | 'REJECT'; adminNote?: string },
    ) {
        return this.walletService.processWithdraw(
          id,
          body.action,
          body.adminNote,
        );
    }
}