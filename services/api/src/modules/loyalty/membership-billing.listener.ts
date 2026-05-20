import { Injectable, Logger } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { MembershipBillingEventKind, MembershipStatus } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { newId } from '../../common/id';
import { MembershipService } from './membership.service';

interface SubscriptionEventPayload {
  providerEventId?: string;
  subscriptionId?: string;
  customerId?: string;
  currentPeriodEnd?: Date;
  amountMinor?: number;
  currency?: string;
  cancelAtPeriodEnd?: boolean;
}

/**
 * Phase 23: applies Stripe subscription-lifecycle events to the local
 * PlusMembership row. Idempotency is enforced by the unique constraint
 * on MembershipBillingEvent.providerEventId — a duplicate webhook
 * delivery hits a P2002 and we treat it as a no-op.
 *
 * The payments module emits these as `membership.subscription_*` events
 * so loyalty doesn't import Stripe types.
 */
@Injectable()
export class MembershipBillingListener {
  private readonly logger = new Logger(MembershipBillingListener.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly membership: MembershipService,
  ) {}

  @OnEvent('membership.subscription_invoice_paid')
  async onInvoicePaid(payload: SubscriptionEventPayload) {
    if (!payload?.subscriptionId || !payload.providerEventId) return;
    const row = await this.membership.getBySubscriptionId(payload.subscriptionId);
    if (!row) {
      this.logger.warn(`invoice.paid for unknown subscription ${payload.subscriptionId}`);
      return;
    }
    try {
      await this.prisma.$transaction([
        this.prisma.membershipBillingEvent.create({
          data: {
            id: newId(),
            membershipId: row.id,
            providerEventId: payload.providerEventId,
            kind: MembershipBillingEventKind.INVOICE_PAID,
            amountMinor: payload.amountMinor ?? null,
            currency: payload.currency ?? null,
            rawSummary: {
              subscriptionId: payload.subscriptionId,
              currentPeriodEnd: payload.currentPeriodEnd?.toISOString() ?? null,
            },
          },
        }),
        this.prisma.plusMembership.update({
          where: { id: row.id },
          data: {
            status: MembershipStatus.ACTIVE,
            renewedAt: new Date(),
            ...(payload.currentPeriodEnd
              ? {
                  currentPeriodEnd: payload.currentPeriodEnd,
                  expiresAt: payload.currentPeriodEnd,
                }
              : {}),
          },
        }),
      ]);
    } catch (e) {
      if ((e as { code?: string })?.code === 'P2002') return; // duplicate webhook
      throw e;
    }
  }

  @OnEvent('membership.subscription_invoice_failed')
  async onInvoiceFailed(payload: SubscriptionEventPayload) {
    if (!payload?.subscriptionId || !payload.providerEventId) return;
    const row = await this.membership.getBySubscriptionId(payload.subscriptionId);
    if (!row) return;
    try {
      await this.prisma.$transaction([
        this.prisma.membershipBillingEvent.create({
          data: {
            id: newId(),
            membershipId: row.id,
            providerEventId: payload.providerEventId,
            kind: MembershipBillingEventKind.INVOICE_FAILED,
            amountMinor: payload.amountMinor ?? null,
            currency: payload.currency ?? null,
            rawSummary: { subscriptionId: payload.subscriptionId },
          },
        }),
        this.prisma.plusMembership.update({
          where: { id: row.id },
          data: { status: MembershipStatus.PAUSED },
        }),
      ]);
    } catch (e) {
      if ((e as { code?: string })?.code === 'P2002') return;
      throw e;
    }
  }

  @OnEvent('membership.subscription_updated')
  async onUpdated(payload: SubscriptionEventPayload) {
    if (!payload?.subscriptionId || !payload.providerEventId) return;
    const row = await this.membership.getBySubscriptionId(payload.subscriptionId);
    if (!row) return;
    try {
      await this.prisma.$transaction([
        this.prisma.membershipBillingEvent.create({
          data: {
            id: newId(),
            membershipId: row.id,
            providerEventId: payload.providerEventId,
            kind: MembershipBillingEventKind.SUB_UPDATED,
            rawSummary: {
              cancelAtPeriodEnd: payload.cancelAtPeriodEnd ?? null,
              currentPeriodEnd: payload.currentPeriodEnd?.toISOString() ?? null,
            },
          },
        }),
        this.prisma.plusMembership.update({
          where: { id: row.id },
          data: {
            autoRenew: payload.cancelAtPeriodEnd === undefined ? row.autoRenew : !payload.cancelAtPeriodEnd,
            ...(payload.currentPeriodEnd
              ? {
                  currentPeriodEnd: payload.currentPeriodEnd,
                  expiresAt: payload.currentPeriodEnd,
                }
              : {}),
          },
        }),
      ]);
    } catch (e) {
      if ((e as { code?: string })?.code === 'P2002') return;
      throw e;
    }
  }

  @OnEvent('membership.subscription_deleted')
  async onDeleted(payload: SubscriptionEventPayload) {
    if (!payload?.subscriptionId || !payload.providerEventId) return;
    const row = await this.membership.getBySubscriptionId(payload.subscriptionId);
    if (!row) return;
    try {
      await this.prisma.$transaction([
        this.prisma.membershipBillingEvent.create({
          data: {
            id: newId(),
            membershipId: row.id,
            providerEventId: payload.providerEventId,
            kind: MembershipBillingEventKind.SUB_DELETED,
            rawSummary: { subscriptionId: payload.subscriptionId },
          },
        }),
        this.prisma.plusMembership.update({
          where: { id: row.id },
          data: {
            status: MembershipStatus.EXPIRED,
            autoRenew: false,
            cancelledAt: row.cancelledAt ?? new Date(),
          },
        }),
      ]);
    } catch (e) {
      if ((e as { code?: string })?.code === 'P2002') return;
      throw e;
    }
  }
}
