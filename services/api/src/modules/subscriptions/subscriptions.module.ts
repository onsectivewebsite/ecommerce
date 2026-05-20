import { Module } from '@nestjs/common';
import { SubscriptionsController } from './subscriptions.controller';
import { SubscriptionsService } from './subscriptions.service';
import { SubscriptionGuard } from './subscription.guard';
import { PaymentsModule } from '../payments/payments.module';

@Module({
  imports: [PaymentsModule],
  providers: [SubscriptionsService, SubscriptionGuard],
  controllers: [SubscriptionsController],
  exports: [SubscriptionsService, SubscriptionGuard],
})
export class SubscriptionsModule {}
