import { Module } from '@nestjs/common';
import { SavedSearchesService } from './saved-searches.service';
import { SavedSearchesScheduler } from './saved-searches.scheduler';
import { AdminSavedSearchesController, SavedSearchesController } from './saved-searches.controller';

@Module({
  controllers: [SavedSearchesController, AdminSavedSearchesController],
  providers: [SavedSearchesService, SavedSearchesScheduler],
  exports: [SavedSearchesService],
})
export class SavedSearchesModule {}
