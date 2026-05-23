import { Module } from '@nestjs/common';
import { SellerListingsService } from './seller-listings.service';
import { SellerListingsController } from './seller-listings.controller';

@Module({
  controllers: [SellerListingsController],
  providers: [SellerListingsService],
  exports: [SellerListingsService],
})
export class SellerListingsModule {}
