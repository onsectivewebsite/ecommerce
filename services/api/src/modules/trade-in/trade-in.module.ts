import { Module } from '@nestjs/common';
import { WalletModule } from '../wallet/wallet.module';
import { TradeInService } from './trade-in.service';
import {
  TradeInAdminController,
  TradeInBuyerController,
  TradeInPublicController,
  TradeInWarehouseController,
} from './trade-in.controller';

@Module({
  imports: [WalletModule],
  controllers: [
    TradeInPublicController,
    TradeInBuyerController,
    TradeInWarehouseController,
    TradeInAdminController,
  ],
  providers: [TradeInService],
  exports: [TradeInService],
})
export class TradeInModule {}
