import { Injectable } from '@nestjs/common';
import type { RiskContext, RiskHit, RiskRule } from './risk.types';

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Built-in rules. Each rule reads exactly what it needs from the context
 * (or the Prisma handle for historical lookups). New rules can be added by
 * creating a class with @Injectable() and binding it in RiskEngine via DI.
 */

@Injectable()
export class VelocityOrdersRule implements RiskRule {
  readonly code = 'velocity-orders';
  async evaluate(ctx: RiskContext): Promise<RiskHit | null> {
    const since = new Date(Date.now() - DAY_MS);
    const count = await ctx.prisma.order.count({
      where: { userId: ctx.userId, createdAt: { gte: since } },
    });
    if (count > 5) {
      return {
        code: this.code,
        score: 25,
        reason: `Buyer placed ${count} orders in the last 24h`,
        details: { count24h: count },
      };
    }
    return null;
  }
}

@Injectable()
export class VelocityPaymentsRule implements RiskRule {
  readonly code = 'velocity-payments';
  async evaluate(ctx: RiskContext): Promise<RiskHit | null> {
    const since = new Date(Date.now() - DAY_MS);
    const rows = await ctx.prisma.payment.findMany({
      where: { order: { userId: ctx.userId }, createdAt: { gte: since } },
      select: { providerRef: true, provider: true },
    });
    const distinct = new Set(rows.map((r) => `${r.provider}:${r.providerRef ?? ''}`)).size;
    if (distinct > 3) {
      return {
        code: this.code,
        score: 30,
        reason: `Buyer used ${distinct} payment refs in 24h`,
        details: { distinctRefs: distinct },
      };
    }
    return null;
  }
}

@Injectable()
export class CountryMismatchRule implements RiskRule {
  readonly code = 'billing-shipping-country-mismatch';
  async evaluate(ctx: RiskContext): Promise<RiskHit | null> {
    if (!ctx.shippingCountry || !ctx.billingCountry) return null;
    if (ctx.shippingCountry === ctx.billingCountry) return null;
    return {
      code: this.code,
      score: 20,
      reason: `Billing ${ctx.billingCountry} ≠ shipping ${ctx.shippingCountry}`,
      details: { billing: ctx.billingCountry, shipping: ctx.shippingCountry },
    };
  }
}

@Injectable()
export class NewAccountHighValueRule implements RiskRule {
  readonly code = 'new-account-high-value';
  async evaluate(ctx: RiskContext): Promise<RiskHit | null> {
    const ageMs = Date.now() - ctx.buyerCreatedAt.getTime();
    const ageHours = ageMs / (60 * 60 * 1000);
    if (ageHours < 24 && ctx.totalMinor >= 50_000 /* $500 */) {
      return {
        code: this.code,
        score: 35,
        reason: `New account (${ageHours.toFixed(1)}h old) placing high-value order`,
        details: { ageHours, totalMinor: ctx.totalMinor },
      };
    }
    return null;
  }
}

@Injectable()
export class SellerHealthAmplifierRule implements RiskRule {
  readonly code = 'seller-low-health';
  async evaluate(ctx: RiskContext): Promise<RiskHit | null> {
    // Use the most recent SellerHealthSnapshot for this order's seller.
    if (!ctx.orderId) return null;
    const order = await ctx.prisma.order.findUnique({
      where: { id: ctx.orderId },
      select: { sellerId: true },
    });
    if (!order) return null;
    const snap = await ctx.prisma.sellerHealthSnapshot.findFirst({
      where: { sellerId: order.sellerId },
      orderBy: { capturedAt: 'desc' },
    });
    if (!snap) return null;
    if (snap.score >= 60) return null;
    // Below 60: add a 0.5× of the deficit as risk score, capped at 25.
    const add = Math.min(25, Math.round((60 - snap.score) * 0.5));
    return {
      code: this.code,
      score: add,
      reason: `Seller health is low (${snap.score}/100)`,
      details: { sellerScore: snap.score, sellerId: order.sellerId },
    };
  }
}
