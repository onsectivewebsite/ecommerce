import { Module } from '@nestjs/common';
import { CollectionsService } from './collections.service';
import { AdminCollectionsController, CollectionsPublicController } from './collections.controller';

@Module({
  controllers: [CollectionsPublicController, AdminCollectionsController],
  providers: [CollectionsService],
  exports: [CollectionsService],
})
export class CollectionsModule {}
