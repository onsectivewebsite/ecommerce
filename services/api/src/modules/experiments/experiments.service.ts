import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { createHash } from 'crypto';
import { PrismaService } from '../../prisma/prisma.service';
import { newId } from '../../common/id';

export interface Variant {
  id: string;
  name: string;
  weight: number; // basis points; sum across variants should equal 10000
}

export interface ExperimentRow {
  id: string;
  key: string;
  status: 'DRAFT' | 'RUNNING' | 'PAUSED' | 'CONCLUDED';
  description: string | null;
  variants: Variant[];
  traffic: number;
}

export interface AssignmentResult {
  experimentKey: string;
  variantId: string | null;
  reason: 'assigned' | 'sticky' | 'excluded';
}

@Injectable()
export class ExperimentsService {
  private readonly logger = new Logger(ExperimentsService.name);
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Sticky bucketing: hash(experimentKey + identityKey) → 0..9999.
   * If the result is over `traffic`, the user is excluded.
   * Otherwise we pick the first variant whose cumulative weight covers the bucket.
   *
   * Persisted to ExperimentAssignment so the bucket survives even if we later
   * rebalance variants (we never re-bucket an already-assigned identity).
   */
  async assign(experimentKey: string, identity: { userId?: string | null; sessionId?: string | null }, context: Record<string, unknown> = {}): Promise<AssignmentResult> {
    const exp = await this.prisma.experiment.findUnique({ where: { key: experimentKey } });
    if (!exp || exp.status !== 'RUNNING') {
      return { experimentKey, variantId: null, reason: 'excluded' };
    }
    const variants = exp.variants as unknown as Variant[];
    if (!Array.isArray(variants) || variants.length === 0) {
      return { experimentKey, variantId: null, reason: 'excluded' };
    }

    // Prefer the user-bound assignment if it exists; otherwise the session-bound one.
    if (identity.userId) {
      const sticky = await this.prisma.experimentAssignment.findUnique({
        where: { experimentKey_userId: { experimentKey, userId: identity.userId } },
      }).catch(() => null);
      if (sticky) return { experimentKey, variantId: sticky.variantId, reason: 'sticky' };
    }
    if (identity.sessionId) {
      const sticky = await this.prisma.experimentAssignment.findUnique({
        where: { experimentKey_sessionId: { experimentKey, sessionId: identity.sessionId } },
      }).catch(() => null);
      if (sticky) {
        // Promote to user once we know who they are.
        if (identity.userId) {
          await this.prisma.experimentAssignment.update({
            where: { id: sticky.id },
            data: { userId: identity.userId },
          }).catch(() => undefined);
        }
        return { experimentKey, variantId: sticky.variantId, reason: 'sticky' };
      }
    }

    const identityKey = identity.userId ?? identity.sessionId;
    if (!identityKey) return { experimentKey, variantId: null, reason: 'excluded' };

    const bucket = hashBucket(`${experimentKey}:${identityKey}`);
    if (bucket >= exp.traffic) {
      return { experimentKey, variantId: null, reason: 'excluded' };
    }

    const variantId = pickVariant(variants, bucket);
    if (!variantId) return { experimentKey, variantId: null, reason: 'excluded' };

    await this.prisma.experimentAssignment.create({
      data: {
        id: newId(),
        experimentId: exp.id,
        experimentKey,
        variantId,
        userId: identity.userId ?? null,
        sessionId: identity.sessionId ?? null,
        context: context as object,
      },
    }).catch((e) => {
      // Race: the row was created concurrently; cheap to ignore.
      this.logger.debug(`assignment race: ${(e as Error).message}`);
    });
    return { experimentKey, variantId, reason: 'assigned' };
  }

  /** GrowthBook SDK-compatible "features payload" — one flag per running experiment. */
  async featurePayload(identity: { userId?: string | null; sessionId?: string | null }) {
    const experiments = await this.prisma.experiment.findMany({ where: { status: 'RUNNING' } });
    const features: Record<string, { defaultValue: string; rules?: unknown[] }> = {};
    for (const exp of experiments) {
      const assignment = await this.assign(exp.key, identity);
      features[exp.key] = {
        defaultValue: assignment.variantId ?? 'control',
      };
    }
    return { features };
  }

  async logExposure(experimentKey: string, identity: { userId?: string | null; sessionId?: string | null }, context: Record<string, unknown> = {}) {
    // For now exposure-logging is implicit (the assignment itself is the exposure record).
    // This endpoint lets the SDK confirm a render happened even when the assignment was sticky.
    return this.assign(experimentKey, identity, context);
  }

  // ----- Admin CRUD -----

  async listForAdmin() {
    return this.prisma.experiment.findMany({ orderBy: { updatedAt: 'desc' } });
  }

  async upsert(key: string, patch: { status?: ExperimentRow['status']; description?: string; variants?: Variant[]; traffic?: number; }) {
    if (patch.variants) {
      const sum = patch.variants.reduce((s, v) => s + v.weight, 0);
      if (sum !== 10000) throw new BadRequestException(`Variant weights must sum to 10000 (got ${sum})`);
    }
    const existing = await this.prisma.experiment.findUnique({ where: { key } });
    if (!existing) {
      return this.prisma.experiment.create({
        data: {
          id: newId(),
          key,
          status: patch.status ?? 'DRAFT',
          description: patch.description ?? null,
          variants: (patch.variants ?? []) as object,
          traffic: patch.traffic ?? 10000,
        },
      });
    }
    return this.prisma.experiment.update({
      where: { id: existing.id },
      data: {
        status: patch.status ?? existing.status,
        description: patch.description ?? existing.description,
        variants: (patch.variants ?? (existing.variants as unknown as Variant[])) as object,
        traffic: patch.traffic ?? existing.traffic,
      },
    });
  }
}

function hashBucket(input: string): number {
  // Simple deterministic hash mod 10000. SHA-256 prefix → uint32 → mod.
  const digest = createHash('sha256').update(input).digest();
  const n = digest.readUInt32BE(0);
  return n % 10000;
}

function pickVariant(variants: Variant[], bucket: number): string | null {
  let cumulative = 0;
  for (const v of variants) {
    cumulative += v.weight;
    if (bucket < cumulative) return v.id;
  }
  return variants[variants.length - 1]?.id ?? null;
}
