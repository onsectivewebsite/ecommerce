import { Global, Module } from '@nestjs/common';
import { NotificationFeedService } from './notification-feed.service';
import { NotificationFeedController } from './notification-feed.controller';
import { OrderEventsFeedListener } from './order-events.listener';

@Global()
@Module({
  controllers: [NotificationFeedController],
  providers: [NotificationFeedService, OrderEventsFeedListener],
  exports: [NotificationFeedService],
})
export class NotificationFeedModule {}
