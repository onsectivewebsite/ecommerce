import { Global, Module } from '@nestjs/common';
import { BrandsService } from './brands.service';
import {
  AdminBrandsController,
  BrandsPublicController,
  SellerBrandAuthorizationsController,
} from './brands.controller';

@Global()
@Module({
  controllers: [
    BrandsPublicController,
    AdminBrandsController,
    SellerBrandAuthorizationsController,
  ],
  providers: [BrandsService],
  exports: [BrandsService],
})
export class BrandsModule {}
