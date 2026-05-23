import { Module } from '@nestjs/common';
import { AnnouncementsService } from './announcements.service';
import {
  AdminAnnouncementsController,
  AnnouncementsBuyerController,
  AnnouncementsPublicController,
} from './announcements.controller';

@Module({
  controllers: [
    AnnouncementsPublicController,
    AnnouncementsBuyerController,
    AdminAnnouncementsController,
  ],
  providers: [AnnouncementsService],
  exports: [AnnouncementsService],
})
export class AnnouncementsModule {}
