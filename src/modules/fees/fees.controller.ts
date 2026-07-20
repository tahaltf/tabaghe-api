import {
  BadRequestException,
  Body,
  Controller,
  Post,
  UseGuards,
} from '@nestjs/common';
import { ListingType, ItemCondition } from '@prisma/client';
import { OptionalJwtAuthGuard } from '../auth/guards/optional-jwt-auth.guard';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { AuthenticatedUser } from '../../shared/contracts/auth';
import {
  FeeCalculatorService,
  FeePreviewResult,
} from './fee-calculator.service';

interface FeePreviewBody {
  listingType: ListingType;
  categoryId?: string | null;
  amount: number | string;
  condition?: ItemCondition | null;
}

@Controller('fees')
@UseGuards(OptionalJwtAuthGuard)
export class FeesController {
  constructor(private readonly feeCalculator: FeeCalculatorService) {}

  /**
   * Returns a structured fee preview for the given listing scenario. When the
   * caller is authenticated, the seller's active plan discount is automatically
   * applied — letting them see «کارمزد پایه»، «تخفیف پلن» و «کارمزد نهایی»
   * exactly as they will be charged at settlement time.
   */
  @Post('preview')
  async preview(
    @Body() body: FeePreviewBody,
    @CurrentUser() actor: AuthenticatedUser | null,
  ): Promise<FeePreviewResult> {
    if (!body || !body.listingType) {
      throw new BadRequestException('listingType الزامی است');
    }
    const amount = Number(body.amount);
    if (!Number.isFinite(amount) || amount < 0) {
      throw new BadRequestException('مبلغ معتبر نیست');
    }

    return this.feeCalculator.previewFee(
      body.listingType,
      body.categoryId ?? null,
      amount,
      actor?.id,
      body.condition ?? null,
    );
  }
}
