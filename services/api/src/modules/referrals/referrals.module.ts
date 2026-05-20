import { Global, Module } from '@nestjs/common';
import { ReferralsService } from './referrals.service';
import { ReferralPayoutListener } from './referrals.listener';
import { AdminReferralsController, ReferralsController } from './referrals.controller';

@Global()
@Module({
  controllers: [ReferralsController, AdminReferralsController],
  providers: [ReferralsService, ReferralPayoutListener],
  exports: [ReferralsService],
})
export class ReferralsModule {}
