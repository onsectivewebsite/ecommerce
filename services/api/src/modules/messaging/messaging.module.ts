import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { MessagingController } from './messaging.controller';
import { MessagingGateway } from './messaging.gateway';
import { MessagingListener } from './messaging.listener';
import { MessagingService } from './messaging.service';

@Module({
  imports: [AuthModule, NotificationsModule],
  controllers: [MessagingController],
  providers: [MessagingService, MessagingGateway, MessagingListener],
  exports: [MessagingService],
})
export class MessagingModule {}
