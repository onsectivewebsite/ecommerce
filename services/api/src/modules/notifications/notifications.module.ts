import { Module } from '@nestjs/common';
import { ExpoPushClient } from './expo-push.client';
import { NotificationsService } from './notifications.service';
import { NotificationsListener } from './notifications.listener';
import { NotificationsController } from './notifications.controller';

@Module({
  controllers: [NotificationsController],
  providers: [ExpoPushClient, NotificationsService, NotificationsListener],
  exports: [NotificationsService],
})
export class NotificationsModule {}
