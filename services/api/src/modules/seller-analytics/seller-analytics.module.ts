import { Global, Module } from '@nestjs/common';
import { SellerAnalyticsController } from './seller-analytics.controller';
import { SellerAnalyticsListener } from './seller-analytics.listener';
import { SellerAnalyticsService } from './seller-analytics.service';

@Global()
@Module({
  controllers: [SellerAnalyticsController],
  providers: [SellerAnalyticsService, SellerAnalyticsListener],
  exports: [SellerAnalyticsService],
})
export class SellerAnalyticsModule {}
