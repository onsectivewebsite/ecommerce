import { Module } from '@nestjs/common';
import { PaymentsModule } from '../payments/payments.module';
import { MessagingModule } from '../messaging/messaging.module';
import { AdminDisputesController, DisputesController } from './disputes.controller';
import { DisputesListener } from './disputes.listener';
import { DisputesService } from './disputes.service';

@Module({
  imports: [PaymentsModule, MessagingModule],
  controllers: [DisputesController, AdminDisputesController],
  providers: [DisputesService, DisputesListener],
  exports: [DisputesService],
})
export class DisputesModule {}
