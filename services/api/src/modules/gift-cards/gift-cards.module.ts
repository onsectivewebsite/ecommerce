import { Global, Module } from '@nestjs/common';
import { GiftCardsService } from './gift-cards.service';
import { GiftCardsListener } from './gift-cards.listener';
import { GiftCardsScheduler } from './gift-cards.scheduler';
import { GiftCardsController, AdminGiftCardsController } from './gift-cards.controller';

// WalletService, PaymentsService, EmailService, AuditService are all provided
// by @Global() modules, so no explicit imports are needed here.
@Global()
@Module({
  controllers: [GiftCardsController, AdminGiftCardsController],
  providers: [GiftCardsService, GiftCardsListener, GiftCardsScheduler],
  exports: [GiftCardsService],
})
export class GiftCardsModule {}
