import { Module } from '@nestjs/common';
import { ReferralRewardService } from './referral-reward.service';
import { ReferralService } from './referral.service';

@Module({
  providers: [ReferralService, ReferralRewardService],
  exports: [ReferralService, ReferralRewardService],
})
export class ReferralModule {}
