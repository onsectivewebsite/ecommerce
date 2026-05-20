import { Module, type Provider } from '@nestjs/common';
import { ShippingController } from './shipping.controller';
import { ShippingService } from './shipping.service';
import { TrackingGateway } from './tracking.gateway';
import { CarrierRegistry } from './carriers/registry';
import { CARRIER_ADAPTERS } from './carriers/types';
import { MockCarrierAdapter } from './carriers/mock.adapter';
import { FedExAdapter } from './carriers/fedex.adapter';
import { UpsAdapter } from './carriers/ups.adapter';
import { DhlAdapter } from './carriers/dhl.adapter';
import { CanadaPostAdapter } from './carriers/canadapost.adapter';

const adaptersProvider: Provider = {
  provide: CARRIER_ADAPTERS,
  useFactory: (
    mock: MockCarrierAdapter,
    fedex: FedExAdapter,
    ups: UpsAdapter,
    dhl: DhlAdapter,
    cp: CanadaPostAdapter,
  ) => [mock, fedex, ups, dhl, cp],
  inject: [MockCarrierAdapter, FedExAdapter, UpsAdapter, DhlAdapter, CanadaPostAdapter],
};

@Module({
  providers: [
    MockCarrierAdapter,
    FedExAdapter,
    UpsAdapter,
    DhlAdapter,
    CanadaPostAdapter,
    adaptersProvider,
    CarrierRegistry,
    ShippingService,
    TrackingGateway,
  ],
  controllers: [ShippingController],
  exports: [ShippingService, CarrierRegistry],
})
export class ShippingModule {}
