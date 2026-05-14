import { Module } from '@nestjs/common';
import { FeeCalculatorService } from './fee-calculator.service';
import { PlanFeeDiscountService } from './plan-fee-discount.service';
import { FeesController } from './fees.controller';
import { AuthModule } from '../auth/auth.module';

@Module({
  imports: [AuthModule],
  controllers: [FeesController],
  providers: [PlanFeeDiscountService, FeeCalculatorService],
  exports: [FeeCalculatorService, PlanFeeDiscountService],
})
export class FeesModule {}
