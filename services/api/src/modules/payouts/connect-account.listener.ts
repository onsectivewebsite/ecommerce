import { Injectable, Logger } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { SellerOnboardingService } from './seller-onboarding.service';

/**
 * Phase 29: forwards `seller.connect.account_updated` from the payments
 * webhook dispatcher to SellerOnboardingService so the local mirror
 * stays fresh without polling.
 */
@Injectable()
export class ConnectAccountListener {
  private readonly logger = new Logger(ConnectAccountListener.name);

  constructor(private readonly onboarding: SellerOnboardingService) {}

  @OnEvent('seller.connect.account_updated')
  async onAccountUpdated(payload: { providerEventId?: string; stripeAccountId?: string }) {
    if (!payload?.stripeAccountId) return;
    try {
      await this.onboarding.syncByStripeAccountId(payload.stripeAccountId);
    } catch (e) {
      this.logger.warn(
        `connect sync failed for ${payload.stripeAccountId}: ${(e as Error).message}`,
      );
    }
  }
}
