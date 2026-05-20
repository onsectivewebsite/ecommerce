import { Module } from '@nestjs/common';
import { NotificationsModule } from '../notifications/notifications.module';
import { WishlistsController } from './wishlists.controller';
import { WishlistsScheduler } from './wishlists.scheduler';
import { WishlistsService } from './wishlists.service';

@Module({
  imports: [NotificationsModule],
  controllers: [WishlistsController],
  providers: [WishlistsService, WishlistsScheduler],
  exports: [WishlistsService],
})
export class WishlistsModule {}
