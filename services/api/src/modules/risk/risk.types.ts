import type { PrismaService } from '../../prisma/prisma.service';

/** Everything a rule may need to make a decision. Keep this purely-data so
 *  rules stay testable. */
export interface RiskContext {
  userId: string;
  orderId?: string;
  subtotalMinor: number;
  totalMinor: number;
  currency: string;
  // Snapshot of the order's addresses — country codes only (data minimization).
  shippingCountry: string;
  billingCountry: string;
  paymentProvider: string;
  // Buyer signals
  buyerCreatedAt: Date;
  // Optional context that some rules want to lazy-load.
  prisma: PrismaService;
}

export interface RiskHit {
  code: string;
  score: number;
  reason: string;
  details?: Record<string, unknown>;
}

export interface RiskRule {
  readonly code: string;
  evaluate(ctx: RiskContext): Promise<RiskHit | null>;
}

export type RiskDecision = 'ALLOW' | 'HOLD' | 'BLOCK';

export interface RiskResult {
  decision: RiskDecision;
  score: number;
  hits: RiskHit[];
}
