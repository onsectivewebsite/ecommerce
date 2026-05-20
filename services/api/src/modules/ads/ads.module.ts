import { Module } from '@nestjs/common';
import { AdsController } from './ads.controller';
import { SellerAdsController } from './seller-ads.controller';
import { AdsService } from './ads.service';
import { AuctionService } from './auction.service';
import { PaymentsModule } from '../payments/payments.module';

@Module({
  imports: [PaymentsModule],
  controllers: [AdsController, SellerAdsController],
  providers: [AdsService, AuctionService],
  exports: [AdsService, AuctionService],
})
export class AdsModule {}
