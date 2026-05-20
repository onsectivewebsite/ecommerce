import { Global, Module } from '@nestjs/common';
import { RepairNetworkService } from './repair-network.service';
import {
  AdminRepairNetworkController,
  BuyerRepairController,
  PartnerRepairController,
} from './repair-network.controller';

@Global()
@Module({
  controllers: [
    AdminRepairNetworkController,
    PartnerRepairController,
    BuyerRepairController,
  ],
  providers: [RepairNetworkService],
  exports: [RepairNetworkService],
})
export class RepairNetworkModule {}
