import { Module } from '@nestjs/common';
import { TaxEngine } from './tax.engine';
import { GstStrategy } from './strategies/gst.strategy';
import { HstStrategy } from './strategies/hst.strategy';
import { VatStrategy } from './strategies/vat.strategy';
import { SalesStrategy } from './strategies/sales.strategy';
import { ConsumptionStrategy } from './strategies/consumption.strategy';
import { AdminTaxController } from './admin-tax.controller';

@Module({
  controllers: [AdminTaxController],
  providers: [
    TaxEngine,
    GstStrategy,
    HstStrategy,
    VatStrategy,
    SalesStrategy,
    ConsumptionStrategy,
  ],
  exports: [TaxEngine],
})
export class TaxModule {}
