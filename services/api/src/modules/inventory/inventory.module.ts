import { Global, Module } from '@nestjs/common';
import { InventoryService } from './inventory.service';
import { ReservationSweeper } from './reservation.sweeper';

@Global()
@Module({
  providers: [InventoryService, ReservationSweeper],
  exports: [InventoryService],
})
export class InventoryModule {}
