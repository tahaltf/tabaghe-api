import { Module } from '@nestjs/common';
import { FeeCalculatorService } from './fee-calculator.service';
import { PlanFeeDiscountService } from './plan-fee-discount.service';
import { VerificationFeeCalculatorService } from './verification-fee-calculator.service';
import { FeesController } from './fees.controller';
import { AuthModule } from '../auth/auth.module';

@Module({
  imports: [AuthModule],
  controllers: [FeesController],
  providers: [
    PlanFeeDiscountService,
    FeeCalculatorService,
    VerificationFeeCalculatorService,
  ],
  exports: [
    FeeCalculatorService,
    PlanFeeDiscountService,
    VerificationFeeCalculatorService,
  ],
})
export class FeesModule {}
