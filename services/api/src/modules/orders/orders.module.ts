import { Module } from '@nestjs/common';
import { OrdersController } from './orders.controller';
import { OrdersService } from './orders.service';
import { PaymentsModule } from '../payments/payments.module';
import { UsersModule } from '../users/users.module';
import { ShippingModule } from '../shipping/shipping.module';
import { ComplianceModule } from '../compliance/compliance.module';
import { TaxModule } from '../tax/tax.module';
// InventoryModule is @Global; no import needed but listed here for clarity.

@Module({
  imports: [PaymentsModule, UsersModule, ShippingModule, ComplianceModule, TaxModule],
  controllers: [OrdersController],
  providers: [OrdersService],
  exports: [OrdersService],
})
export class OrdersModule {}
