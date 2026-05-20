import { Global, Module } from '@nestjs/common';
import { ReturnsDispositionService } from './returns-disposition.service';
import {
  AdminReturnsDispositionController,
  OutletPublicController,
  WarehouseReturnsController,
} from './returns-disposition.controller';

@Global()
@Module({
  controllers: [
    OutletPublicController,
    WarehouseReturnsController,
    AdminReturnsDispositionController,
  ],
  providers: [ReturnsDispositionService],
  exports: [ReturnsDispositionService],
})
export class ReturnsDispositionModule {}
