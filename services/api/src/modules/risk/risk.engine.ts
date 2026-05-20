import { Inject, Injectable, Logger } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { PrismaService } from '../../prisma/prisma.service';
import { newId } from '../../common/id';
import type { RiskContext, RiskDecision, RiskHit, RiskResult, RiskRule } from './risk.types';

export const RISK_RULES = Symbol('RISK_RULES');

@Injectable()
export class RiskEngine {
  private readonly logger = new Logger(RiskEngine.name);
  private readonly holdThreshold = Number(process.env.RISK_HOLD_THRESHOLD ?? '60');
  private readonly blockThreshold = Number(process.env.RISK_BLOCK_THRESHOLD ?? '90');

  constructor(
    private readonly prisma: PrismaService,
    private readonly events: EventEmitter2,
    @Inject(RISK_RULES) private readonly rules: RiskRule[],
  ) {}

  /** Run all rules, decide an outcome, persist the assessment + a hold if needed. */
  async assessAndPersist(orderId: string, ctx: Omit<RiskContext, 'orderId' | 'prisma'>): Promise<RiskResult> {
    const fullCtx: RiskContext = { ...ctx, orderId, prisma: this.prisma };
    const hits = await this.collectHits(fullCtx);
    const score = hits.reduce((s, h) => s + h.score, 0);
    const decision = this.decide(score);

    // Upsert RiskAssessment + hits.
    const existing = await this.prisma.riskAssessment.findUnique({ where: { orderId } });
    if (existing) {
      await this.prisma.$transaction([
        this.prisma.riskRuleHit.deleteMany({ where: { assessmentId: existing.id } }),
        this.prisma.riskAssessment.update({
          where: { id: existing.id },
          data: { score, decision, hitCount: hits.length },
        }),
        ...hits.map((h) => this.prisma.riskRuleHit.create({
          data: { id: newId(), assessmentId: existing.id, code: h.code, score: h.score, reason: h.reason, details: h.details ?? {} },
        })),
      ]);
    } else {
      const created = await this.prisma.riskAssessment.create({
        data: { id: newId(), orderId, score, decision, hitCount: hits.length },
      });
      if (hits.length > 0) {
        await this.prisma.riskRuleHit.createMany({
          data: hits.map((h) => ({
            id: newId(), assessmentId: created.id, code: h.code, score: h.score, reason: h.reason, details: h.details ?? {},
          })),
        });
      }
    }

    if (decision === 'HOLD') {
      const reason = hits.map((h) => h.code).join(',');
      await this.prisma.orderHold.upsert({
        where: { orderId },
        create: { id: newId(), orderId, reason, status: 'OPEN' },
        update: { reason, status: 'OPEN', reviewedAt: null, reviewedBy: null, reviewNote: null },
      });
    }

    this.events.emit('risk.assessed', { orderId, score, decision });
    return { decision, score, hits };
  }

  /** Score-only path: callers that want to short-circuit checkout BEFORE persisting an Order. */
  async previewScore(ctx: Omit<RiskContext, 'orderId' | 'prisma'>): Promise<RiskResult> {
    const fullCtx: RiskContext = { ...ctx, prisma: this.prisma };
    const hits = await this.collectHits(fullCtx);
    const score = hits.reduce((s, h) => s + h.score, 0);
    return { decision: this.decide(score), score, hits };
  }

  private async collectHits(ctx: RiskContext): Promise<RiskHit[]> {
    const out: RiskHit[] = [];
    for (const r of this.rules) {
      try {
        const hit = await r.evaluate(ctx);
        if (hit) out.push(hit);
      } catch (e) {
        this.logger.warn(`risk rule ${r.code} failed: ${(e as Error).message}`);
      }
    }
    return out;
  }

  private decide(score: number): RiskDecision {
    if (score >= this.blockThreshold) return 'BLOCK';
    if (score >= this.holdThreshold) return 'HOLD';
    return 'ALLOW';
  }
}
