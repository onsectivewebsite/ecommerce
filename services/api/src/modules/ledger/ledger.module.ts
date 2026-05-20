import { Global, Module } from '@nestjs/common';
import { LedgerService } from './ledger.service';
import { CommissionBooker } from './commission.booker';

@Global()
@Module({
  providers: [LedgerService, CommissionBooker],
  exports: [LedgerService],
})
export class LedgerModule {}
