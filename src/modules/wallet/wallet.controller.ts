import {
    Body,
    Controller,
    Get,
    Post,
    Req,
    UseGuards,
} from '@nestjs/common';
import { WalletService } from './wallet.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';

@Controller('wallet')
@UseGuards(JwtAuthGuard)
export class WalletController {
    constructor(private readonly walletService: WalletService) {}

    // -----------------------------
    // Get my wallet
    // -----------------------------
    @Get('me')
    async getMyWallet(@Req() req: any) {
        return this.walletService.getWalletByUserId(req.user.id);
    }

    // -----------------------------
    // Fake deposit (for now)
    // -----------------------------
    @Post('deposit')
    async deposit(
        @Req() req: any,
        @Body() body: { amount: number },
    ) {
        return this.walletService.deposit(
            req.user.id,
            body.amount,
            { source: 'manual-test' },
        );
    }
}
