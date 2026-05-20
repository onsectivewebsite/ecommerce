import { Global, Module } from '@nestjs/common';
import { LoyaltyMembershipController, LoyaltyPointsController } from './loyalty.controller';
import { MembershipService } from './membership.service';
import { PointsService } from './points.service';
import { LoyaltyListener } from './loyalty.listener';
import { MembershipBillingListener } from './membership-billing.listener';
import { PlusNotificationsListener } from './plus-notifications.listener';
import { PlusExpiringSoonScheduler } from './plus-expiring-soon.scheduler';
import { PlusAdminService } from './plus-admin.service';
import { PlusAdminController } from './plus-admin.controller';

@Global()
@Module({
  controllers: [LoyaltyMembershipController, LoyaltyPointsController, PlusAdminController],
  providers: [
    MembershipService,
    PointsService,
    LoyaltyListener,
    MembershipBillingListener,
    PlusNotificationsListener,
    PlusExpiringSoonScheduler,
    PlusAdminService,
  ],
  exports: [MembershipService, PointsService, PlusExpiringSoonScheduler],
})
export class LoyaltyModule {}
