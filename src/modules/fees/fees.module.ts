import { Module } from '@nestjs/common';
import { FeeCalculatorService } from './fee-calculator.service';

@Module({
  providers: [FeeCalculatorService],
  exports: [FeeCalculatorService], // اکسپورت برای استفاده در سفارشات و مزایده
})
export class FeesModule {}