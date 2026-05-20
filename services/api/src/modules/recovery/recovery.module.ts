import { Global, Module } from '@nestjs/common';
import { PasswordResetService } from './password-reset.service';
import { AccountRecoveryService } from './account-recovery.service';
import { AccountRecoveryScheduler } from './account-recovery.scheduler';
import { RecoveryController, AdminRecoveryController } from './recovery.controller';

@Global()
@Module({
  controllers: [RecoveryController, AdminRecoveryController],
  providers: [PasswordResetService, AccountRecoveryService, AccountRecoveryScheduler],
  exports: [PasswordResetService, AccountRecoveryService],
})
export class RecoveryModule {}
