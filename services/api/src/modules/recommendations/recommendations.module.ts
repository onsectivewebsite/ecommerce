import { Module } from '@nestjs/common';
import { RecommendationsService } from './recommendations.service';
import { CoViewListener } from './co-view.listener';
import { RecommendationsController } from './recommendations.controller';

@Module({
  controllers: [RecommendationsController],
  providers: [RecommendationsService, CoViewListener],
  exports: [RecommendationsService],
})
export class RecommendationsModule {}
