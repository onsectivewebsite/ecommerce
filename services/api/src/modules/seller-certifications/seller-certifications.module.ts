import { Global, Module } from '@nestjs/common';
import { SellerCertificationsService } from './seller-certifications.service';
import {
  AdminCertificationsController,
  SellerCertificationsSellerController,
} from './seller-certifications.controller';

@Global()
@Module({
  controllers: [SellerCertificationsSellerController, AdminCertificationsController],
  providers: [SellerCertificationsService],
  exports: [SellerCertificationsService],
})
export class SellerCertificationsModule {}
