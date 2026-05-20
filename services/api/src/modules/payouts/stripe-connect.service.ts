import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Stripe from 'stripe';

/**
 * Thin wrapper around Stripe Connect APIs. In dev (no STRIPE_SECRET_KEY)
 * every method that needs Stripe throws — callers check `isLive()` first
 * and fall back to PayoutMethod.MANUAL.
 */
@Injectable()
export class StripeConnectService {
  private readonly logger = new Logger(StripeConnectService.name);
  private readonly stripe: Stripe | null;

  constructor(cfg: ConfigService) {
    const key = cfg.get<string>('STRIPE_SECRET_KEY');
    this.stripe = key ? new Stripe(key, { apiVersion: '2024-06-20' }) : null;
    if (!this.stripe) this.logger.warn('STRIPE_SECRET_KEY missing — payouts default to MANUAL');
  }

  isLive() { return Boolean(this.stripe); }

  private require(): Stripe {
    if (!this.stripe) throw new Error('Stripe not configured');
    return this.stripe;
  }

  /** Create a Connect Express account for a seller. */
  async createConnectAccount(email: string, country = 'US'): Promise<string> {
    const stripe = this.require();
    const acct = await stripe.accounts.create({
      type: 'express',
      country,
      email,
      capabilities: { transfers: { requested: true } },
    });
    return acct.id;
  }

  /** Transfer funds from the platform balance to a connected account. */
  async transfer(args: {
    destinationAccountId: string;
    amountMinor: number;
    currency: string;
    metadata?: Record<string, string>;
  }): Promise<{ id: string }> {
    const stripe = this.require();
    const t = await stripe.transfers.create({
      amount: args.amountMinor,
      currency: args.currency.toLowerCase(),
      destination: args.destinationAccountId,
      metadata: args.metadata,
    });
    return { id: t.id };
  }

  // ---------------- Phase 29: hosted onboarding ----------------

  /**
   * Single-use Stripe-hosted onboarding URL. The seller-web redirects the
   * seller here; Stripe collects the requirements and bounces back to
   * `returnUrl`. If Stripe asks for more info mid-flow it can bounce to
   * `refreshUrl` to request a fresh link.
   */
  async createAccountLink(args: {
    accountId: string;
    returnUrl: string;
    refreshUrl: string;
  }): Promise<{ url: string; expiresAt: Date }> {
    const stripe = this.require();
    const link = await stripe.accountLinks.create({
      account: args.accountId,
      type: 'account_onboarding',
      return_url: args.returnUrl,
      refresh_url: args.refreshUrl,
    });
    return { url: link.url, expiresAt: new Date(link.expires_at * 1000) };
  }

  /**
   * Stripe-hosted Express dashboard URL. Only valid for accounts that
   * have completed onboarding (charges + payouts enabled).
   */
  async createLoginLink(accountId: string): Promise<{ url: string }> {
    const stripe = this.require();
    const link = await stripe.accounts.createLoginLink(accountId);
    return { url: link.url };
  }

  /**
   * Read the canonical state of an Express account. Returned shape is
   * intentionally narrow — only what SellerService.syncConnectStatus
   * needs to decide on the local mirror.
   */
  async retrieveAccount(accountId: string): Promise<{
    chargesEnabled: boolean;
    payoutsEnabled: boolean;
    detailsSubmitted: boolean;
    disabledReason: string | null;
    requirementsDue: string[];
  }> {
    const stripe = this.require();
    const acct = await stripe.accounts.retrieve(accountId);
    return {
      chargesEnabled: !!acct.charges_enabled,
      payoutsEnabled: !!acct.payouts_enabled,
      detailsSubmitted: !!acct.details_submitted,
      disabledReason: acct.requirements?.disabled_reason ?? null,
      requirementsDue: acct.requirements?.currently_due ?? [],
    };
  }
}
