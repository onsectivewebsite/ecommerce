import { Module } from '@nestjs/common';
import { ReviewsService } from './reviews.service';
import {
  AdminReviewsController,
  ReviewsController,
  SellerReviewsController,
} from './reviews.controller';
import { SearchModule } from '../search/search.module';

@Module({
  imports: [SearchModule],
  controllers: [ReviewsController, SellerReviewsController, AdminReviewsController],
  providers: [ReviewsService],
  exports: [ReviewsService],
})
export class ReviewsModule {}
