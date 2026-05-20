import { Module } from '@nestjs/common';
import { DigitalGoodsService } from './digital-goods.service';
import { DeliveryService } from './delivery.service';
import { KeyCrypto } from './key-crypto';
import { SellerDigitalController } from './seller-digital.controller';
import { BuyerDownloadsController } from './buyer-downloads.controller';

@Module({
  controllers: [SellerDigitalController, BuyerDownloadsController],
  providers: [DigitalGoodsService, DeliveryService, KeyCrypto],
  exports: [DigitalGoodsService, DeliveryService],
})
export class DigitalGoodsModule {}
