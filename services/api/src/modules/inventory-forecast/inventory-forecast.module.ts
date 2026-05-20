import { Module } from '@nestjs/common';
import { NotificationsModule } from '../notifications/notifications.module';
import { InventoryForecastController } from './inventory-forecast.controller';
import { InventoryForecastScheduler } from './inventory-forecast.scheduler';
import { InventoryForecastService } from './inventory-forecast.service';

@Module({
  imports: [NotificationsModule],
  controllers: [InventoryForecastController],
  providers: [InventoryForecastService, InventoryForecastScheduler],
  exports: [InventoryForecastService],
})
export class InventoryForecastModule {}
