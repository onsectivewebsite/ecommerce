import { Global, Module } from '@nestjs/common';
import { RefurbUnitsService } from './refurb-units.service';
import {
  RefurbUnitsPublicController,
  SellerRefurbUnitsController,
} from './refurb-units.controller';

@Global()
@Module({
  controllers: [RefurbUnitsPublicController, SellerRefurbUnitsController],
  providers: [RefurbUnitsService],
  exports: [RefurbUnitsService],
})
export class RefurbUnitsModule {}
