import { Module } from '@nestjs/common';
import { BuyBoxService } from './buybox.service';
import { BuyBoxController } from './buybox.controller';

@Module({
  controllers: [BuyBoxController],
  providers: [BuyBoxService],
  exports: [BuyBoxService],
})
export class BuyBoxModule {}
