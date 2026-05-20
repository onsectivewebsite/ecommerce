import { Injectable, Logger } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { GiftCardsService } from './gift-cards.service';

/**
 * Phase 35: bridges the payment webhook to the gift-card lifecycle.
 * `PaymentsService.handleWebhook` emits these events for any PaymentIntent
 * stamped with a `giftCardId` in its metadata.
 */
@Injectable()
export class GiftCardsListener {
  private readonly logger = new Logger(GiftCardsListener.name);

  constructor(private readonly giftCards: GiftCardsService) {}

  @OnEvent('giftcard.purchase.paid')
  async onPaid(payload: { giftCardId: string }) {
    try {
      await this.giftCards.markPaid(payload.giftCardId);
    } catch (e) {
      this.logger.warn(`markPaid ${payload.giftCardId} failed: ${(e as Error).message}`);
    }
  }

  @OnEvent('giftcard.purchase.failed')
  async onFailed(payload: { giftCardId: string }) {
    try {
      await this.giftCards.markFailed(payload.giftCardId);
    } catch (e) {
      this.logger.warn(`markFailed ${payload.giftCardId} failed: ${(e as Error).message}`);
    }
  }
}
