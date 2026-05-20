import { Module } from '@nestjs/common';
import { WalletModule } from '../wallet/wallet.module';
import { WarrantyService } from './warranty.service';
import { AdminWarrantyController, WarrantyBuyerController } from './warranty.controller';

@Module({
  imports: [WalletModule],
  controllers: [WarrantyBuyerController, AdminWarrantyController],
  providers: [WarrantyService],
  exports: [WarrantyService],
})
export class WarrantyModule {}
