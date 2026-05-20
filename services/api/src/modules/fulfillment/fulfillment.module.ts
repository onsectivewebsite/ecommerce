import { Global, Module } from '@nestjs/common';
import { FulfillmentListener } from './fulfillment.listener';
import { InboundService } from './inbound.service';
import { SellerInboundController, WarehouseInboundController } from './inbound.controller';
import { InventoryStockService } from './inventory-stock.service';
import { PickListController } from './pick-list.controller';
import { PickListService } from './pick-list.service';
import { RoutingService } from './routing.service';
import { StorageFeesController } from './storage-fees.controller';
import { StorageFeesScheduler } from './storage-fees.scheduler';
import { StorageFeesService } from './storage-fees.service';
import {
  AdminWarehousesController,
  WarehousesPublicController,
} from './warehouses.controller';
import { WarehousesService } from './warehouses.service';

@Global()
@Module({
  controllers: [
    WarehousesPublicController,
    AdminWarehousesController,
    SellerInboundController,
    WarehouseInboundController,
    PickListController,
    StorageFeesController,
  ],
  providers: [
    WarehousesService,
    InventoryStockService,
    InboundService,
    RoutingService,
    PickListService,
    StorageFeesService,
    StorageFeesScheduler,
    FulfillmentListener,
  ],
  exports: [WarehousesService, InventoryStockService, InboundService, RoutingService],
})
export class FulfillmentModule {}
