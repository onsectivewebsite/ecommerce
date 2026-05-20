import { Module } from '@nestjs/common';
import { NotificationsModule } from '../notifications/notifications.module';
import { AdminSellerHealthController, SellerHealthController } from './seller-health.controller';
import { SellerHealthScheduler } from './seller-health.scheduler';
import { SellerHealthService } from './seller-health.service';

@Module({
  imports: [NotificationsModule],
  controllers: [SellerHealthController, AdminSellerHealthController],
  providers: [SellerHealthService, SellerHealthScheduler],
  exports: [SellerHealthService],
})
export class SellerHealthModule {}
