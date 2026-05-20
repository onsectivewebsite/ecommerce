import { Global, Module } from '@nestjs/common';
import { SustainabilityService } from './sustainability.service';
import { SustainabilityListener } from './sustainability.listener';
import {
  AdminSustainabilityController,
  BuyerSustainabilityController,
  SustainabilityPublicController,
} from './sustainability.controller';

@Global()
@Module({
  controllers: [
    SustainabilityPublicController,
    BuyerSustainabilityController,
    AdminSustainabilityController,
  ],
  providers: [SustainabilityService, SustainabilityListener],
  exports: [SustainabilityService],
})
export class SustainabilityModule {}
