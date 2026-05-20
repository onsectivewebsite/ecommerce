import { Module } from '@nestjs/common';
import { ListingFeesController } from './listing-fees.controller';
import { ListingFeesService } from './listing-fees.service';

@Module({
  providers: [ListingFeesService],
  controllers: [ListingFeesController],
  exports: [ListingFeesService],
})
export class ListingFeesModule {}
