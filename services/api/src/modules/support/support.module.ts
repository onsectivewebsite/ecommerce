import { Module } from '@nestjs/common';
import { PaymentsModule } from '../payments/payments.module';
import { MessagingModule } from '../messaging/messaging.module';
import { SupportController } from './support.controller';
import { SupportService } from './support.service';

@Module({
  imports: [PaymentsModule, MessagingModule],
  controllers: [SupportController],
  providers: [SupportService],
  exports: [SupportService],
})
export class SupportModule {}
