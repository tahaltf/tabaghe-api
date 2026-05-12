import { Module } from '@nestjs/common';
import { FeeCalculatorService } from './fee-calculator.service';
import { PlanFeeDiscountService } from './plan-fee-discount.service';

@Module({
  providers: [PlanFeeDiscountService, FeeCalculatorService],
  exports: [FeeCalculatorService, PlanFeeDiscountService],
})
export class FeesModule {}