import { Module } from '@nestjs/common';
import { SellerController } from './seller.controller';
import { SellerService } from './seller.service';
import { CatalogModule } from '../catalog/catalog.module';
import { ListingFeesModule } from '../listing-fees/listing-fees.module';
import { SubscriptionsModule } from '../subscriptions/subscriptions.module';
import { BulkImportController } from './bulk-import.controller';
import { BulkImportService } from './bulk-import.service';
import { AnalyticsController } from './analytics.controller';
import { AnalyticsService } from './analytics.service';

@Module({
  imports: [CatalogModule, ListingFeesModule, SubscriptionsModule],
  controllers: [SellerController, BulkImportController, AnalyticsController],
  providers: [SellerService, BulkImportService, AnalyticsService],
  exports: [SellerService],
})
export class SellerModule {}
