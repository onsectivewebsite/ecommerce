import { Module } from '@nestjs/common';
import { ReturnsService } from './returns.service';
import { ReturnsListener } from './returns.listener';
import {
  AdminReturnsController,
  ReturnsController,
  SellerReturnsController,
} from './returns.controller';
import { ShippingModule } from '../shipping/shipping.module';
import { PaymentsModule } from '../payments/payments.module';

@Module({
  imports: [ShippingModule, PaymentsModule],
  controllers: [ReturnsController, SellerReturnsController, AdminReturnsController],
  providers: [ReturnsService, ReturnsListener],
  exports: [ReturnsService],
})
export class ReturnsModule {}
