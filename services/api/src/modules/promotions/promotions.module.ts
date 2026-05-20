import { Global, Module } from '@nestjs/common';
import { AdminPromotionsController, SellerPromotionsController } from './promotions.controller';
import { PromotionsService } from './promotions.service';

@Global()
@Module({
  controllers: [SellerPromotionsController, AdminPromotionsController],
  providers: [PromotionsService],
  exports: [PromotionsService],
})
export class PromotionsModule {}
