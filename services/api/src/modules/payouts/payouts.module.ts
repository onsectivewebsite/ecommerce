import { Module } from '@nestjs/common';
import { PayoutsController } from './payouts.controller';
import { PayoutsService } from './payouts.service';
import { StripeConnectService } from './stripe-connect.service';
import { PayoutsScheduler } from './payouts.scheduler';
import { SellerOnboardingService } from './seller-onboarding.service';
import {
  AdminSellerConnectController,
  SellerOnboardingController,
  SellerOnboardingReturnController,
} from './seller-onboarding.controller';
import { ConnectAccountListener } from './connect-account.listener';

@Module({
  providers: [
    PayoutsService,
    StripeConnectService,
    PayoutsScheduler,
    SellerOnboardingService,
    ConnectAccountListener,
  ],
  controllers: [
    PayoutsController,
    SellerOnboardingController,
    SellerOnboardingReturnController,
    AdminSellerConnectController,
  ],
  exports: [PayoutsService, SellerOnboardingService, StripeConnectService],
})
export class PayoutsModule {}
