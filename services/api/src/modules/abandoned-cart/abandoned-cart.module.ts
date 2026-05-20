import { Module } from '@nestjs/common';
import { NotificationsModule } from '../notifications/notifications.module';
import { AbandonedCartScheduler } from './abandoned-cart.scheduler';
import { AbandonedCartService } from './abandoned-cart.service';

@Module({
  imports: [NotificationsModule],
  providers: [AbandonedCartService, AbandonedCartScheduler],
  exports: [AbandonedCartService],
})
export class AbandonedCartModule {}
