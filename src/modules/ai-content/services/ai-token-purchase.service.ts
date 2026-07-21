import {
  BadRequestException,
  HttpException,
  HttpStatus,
  Injectable,
} from '@nestjs/common';
import {
  WalletTransactionStatus,
  WalletTransactionType,
} from '@prisma/client';
import { Decimal } from 'decimal.js';
import { PrismaService } from '../../../infrastructure/prisma/prisma.service';
import { AiContentSettingsService } from './ai-content-settings.service';
import { AiTokenService } from './ai-token.service';

@Injectable()
export class AiTokenPurchaseService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly settings: AiContentSettingsService,
    private readonly tokens: AiTokenService,
  ) {}

  async purchase(userId: string, packSize: number) {
    const packs = await this.settings.getTokenPacks();
    if (!packs.includes(packSize)) {
      throw new BadRequestException('بسته توکن انتخاب‌شده معتبر نیست');
    }

    const unitPrice = await this.settings.getTokenPriceToman();
    const totalPrice = packSize * unitPrice;

    return this.prisma.$transaction(async (tx) => {
      const wallet = await tx.wallet.findUnique({ where: { userId } });
      if (!wallet || new Decimal(wallet.balanceAvailable).lt(totalPrice)) {
        throw new HttpException(
          {
            message: 'موجودی کیف پول کافی نیست. ابتدا کیف پول خود را شارژ کنید.',
            code: 'INSUFFICIENT_WALLET',
            walletUrl: '/dashboard/wallet',
          },
          HttpStatus.PAYMENT_REQUIRED,
        );
      }

      await tx.wallet.update({
        where: { userId },
        data: { balanceAvailable: { decrement: totalPrice } },
      });

      const walletTx = await tx.walletTransaction.create({
        data: {
          walletId: wallet.id,
          amount: totalPrice,
          type: WalletTransactionType.AI_TOKEN_PURCHASE,
          status: WalletTransactionStatus.SUCCESS,
          referenceId: `ai-tokens-${packSize}`,
          meta: {
            description: `خرید ${packSize} توکن تولید محتوا`,
            packSize,
            unitPrice,
          },
        },
      });

      const balance = await this.tokens.grantPurchased(
        userId,
        packSize,
        {
          walletTxId: walletTx.id,
          note: `خرید ${packSize} توکن`,
        },
        tx,
      );

      return {
        purchasedTokens: packSize,
        totalPrice,
        unitPrice,
        balance,
      };
    });
  }
}
