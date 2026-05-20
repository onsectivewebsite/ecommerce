import { Global, Module } from '@nestjs/common';
import { DataExportService } from './data-export.service';
import { DataExportScheduler } from './data-export.scheduler';
import { AccountDeletionService } from './account-deletion.service';
import { AccountDeletionScheduler } from './account-deletion.scheduler';
import { ConsentService } from './consent.service';
import { AdminPrivacyController, PrivacyController } from './privacy.controller';

@Global()
@Module({
  controllers: [PrivacyController, AdminPrivacyController],
  providers: [
    DataExportService,
    DataExportScheduler,
    AccountDeletionService,
    AccountDeletionScheduler,
    ConsentService,
  ],
  exports: [
    DataExportService,
    AccountDeletionService,
    AccountDeletionScheduler,
    ConsentService,
  ],
})
export class PrivacyModule {}
