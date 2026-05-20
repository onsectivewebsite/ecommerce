import { Module } from '@nestjs/common';
import { UserPrefsService } from './user-prefs.service';
import { UserPrefsController } from './user-prefs.controller';

@Module({
  controllers: [UserPrefsController],
  providers: [UserPrefsService],
  exports: [UserPrefsService],
})
export class I18nModule {}
