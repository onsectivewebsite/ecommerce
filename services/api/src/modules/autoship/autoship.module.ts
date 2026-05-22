import { Module } from '@nestjs/common';
import { OrdersModule } from '../orders/orders.module';
import { AutoshipService } from './autoship.service';
import { AutoshipScheduler } from './autoship.scheduler';
import { AdminAutoshipController, AutoshipController } from './autoship.controller';

@Module({
  imports: [OrdersModule],
  controllers: [AutoshipController, AdminAutoshipController],
  providers: [AutoshipService, AutoshipScheduler],
  exports: [AutoshipService],
})
export class AutoshipModule {}
