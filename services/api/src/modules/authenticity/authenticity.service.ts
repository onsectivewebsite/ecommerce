import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { AuthenticityOutcome } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { newId } from '../../common/id';
import { AuditService } from '../audit/audit.service';
import { InventoryStockService } from '../fulfillment/inventory-stock.service';
import { RefurbUnitsService } from '../refurb-units/refurb-units.service';

interface ActorMeta {
  userId: string;
  ip?: string;
  userAgent?: string;
}

export interface AuthenticityEvidenceItem {
  kind: 'PHOTO' | 'SERIAL_SCAN' | 'HOLOGRAM' | 'BOX' | 'NOTE';
  url?: string;
  note?: string;
}

export interface CreateCheckInput {
  inboundItemId?: string; // pooled NEW_GENUINE inbound line
  refurbUnitId?: string;  // per-unit refurb check
  serialNumber?: string;
  outcome: AuthenticityOutcome;
  evidence: AuthenticityEvidenceItem[];
  reason?: string;
}

/**
 * Mandatory inbound authenticity. No stock goes live without a recorded
 * PASS check. The check is the *only* path that releases inventory:
 *   - pooled NEW_GENUINE: PASS calls InventoryStockService.receiveInbound
 *   - per-unit REFURB:    PASS flips the RefurbUnit AVAILABLE
 * FAIL stays quarantined and emits a seller-health hit.
 */
@Injectable()
export class AuthenticityService {
  private readonly logger = new Logger(AuthenticityService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly events: EventEmitter2,
    private readonly stock: InventoryStockService,
    private readonly refurbUnits: RefurbUnitsService,
  ) {}

  async create(input: CreateCheckInput, actor: ActorMeta) {
    if (!input.inboundItemId && !input.refurbUnitId) {
      throw new BadRequestException('inboundItemId or refurbUnitId is required');
    }
    if (input.evidence.length === 0 && input.outcome !== AuthenticityOutcome.NEEDS_REVIEW) {
      throw new BadRequestException('Evidence is required for PASS/FAIL');
    }

    let inboundItem: { id: string; variantId: string; warehouseId: string; receivedQty: number } | null =
      null;
    if (input.inboundItemId) {
      const row = await this.prisma.inboundShipmentItem.findUnique({
        where: { id: input.inboundItemId },
        include: { shipment: { select: { warehouseId: true } } },
      });
      if (!row) throw new NotFoundException('Inbound line not found');
      inboundItem = {
        id: row.id,
        variantId: row.variantId,
        warehouseId: row.shipment.warehouseId,
        receivedQty: row.receivedQty,
      };
    }
    if (input.refurbUnitId) {
      const unit = await this.prisma.refurbUnit.findUnique({ where: { id: input.refurbUnitId } });
      if (!unit) throw new NotFoundException('Refurb unit not found');
    }

    // Phase 16: surface AI/human divergence in the recorded reason so the
    // audit log makes overrides easy to find. The AI suggestion itself is
    // already recorded in AiInferenceRun; we just annotate the human row.
    const aiReason = await this.maybeDivergenceNote(
      'AUTH',
      input.inboundItemId ?? input.refurbUnitId!,
      input.inboundItemId ? 'inboundItem' : 'refurbUnit',
      input.outcome,
    );
    const finalReason = aiReason
      ? `${input.reason ?? ''}${input.reason ? ' | ' : ''}${aiReason}`.trim()
      : input.reason ?? null;

    const created = await this.prisma.authenticityCheck.create({
      data: {
        id: newId(),
        inboundItemId: input.inboundItemId ?? null,
        refurbUnitId: input.refurbUnitId ?? null,
        serialNumber: input.serialNumber ?? null,
        outcome: input.outcome,
        inspectorUserId: actor.userId,
        evidence: input.evidence as unknown as object,
        reason: finalReason,
      },
    });

    await this.audit.record({
      actorUserId: actor.userId,
      action: 'authenticity.check',
      entityType: 'AuthenticityCheck',
      entityId: created.id,
      after: {
        outcome: input.outcome,
        inboundItemId: input.inboundItemId,
        refurbUnitId: input.refurbUnitId,
      },
      ip: actor.ip,
      userAgent: actor.userAgent,
    });

    if (input.outcome === AuthenticityOutcome.PASS) {
      if (input.refurbUnitId) {
        await this.refurbUnits.markAvailableAfterAuthCheck(input.refurbUnitId);
      }
      if (inboundItem && inboundItem.receivedQty > 0) {
        // Stock only goes live after a PASS check, not at receive time.
        await this.stock.receiveInbound(
          inboundItem.variantId,
          inboundItem.warehouseId,
          inboundItem.receivedQty,
        );
      }
      this.events.emit('authenticity.passed', { id: created.id });
    } else if (input.outcome === AuthenticityOutcome.FAIL) {
      if (input.refurbUnitId) {
        await this.refurbUnits.quarantine(input.refurbUnitId, input.reason ?? 'auth-check-fail');
      }
      this.events.emit('authenticity.failed', {
        id: created.id,
        inboundItemId: input.inboundItemId,
        refurbUnitId: input.refurbUnitId,
        reason: input.reason,
      });
    } else {
      // NEEDS_REVIEW — pending admin queue review; nothing live yet.
      this.events.emit('authenticity.needs-review', { id: created.id });
    }

    return created;
  }

  list(filter: { outcome?: AuthenticityOutcome; serialNumber?: string; limit?: number } = {}) {
    return this.prisma.authenticityCheck.findMany({
      where: { outcome: filter.outcome, serialNumber: filter.serialNumber },
      orderBy: { createdAt: 'desc' },
      take: Math.min(500, filter.limit ?? 100),
    });
  }

  pendingReviewQueue() {
    return this.prisma.authenticityCheck.findMany({
      where: { outcome: AuthenticityOutcome.NEEDS_REVIEW },
      orderBy: { createdAt: 'asc' },
      include: { refurbUnit: true },
      take: 200,
    });
  }

  /**
   * Look up the most recent AI AUTH run for this input. If it exists and its
   * suggestion differs from the human's, return a short note so the
   * AuthenticityCheck.reason captures the override.
   */
  private async maybeDivergenceNote(
    kind: 'AUTH',
    inputRefId: string,
    inputRefKind: 'refurbUnit' | 'inboundItem',
    humanOutcome: AuthenticityOutcome,
  ): Promise<string | null> {
    const run = await this.prisma.aiInferenceRun.findFirst({
      where: { kind, inputRefKind, inputRefId },
      orderBy: { createdAt: 'desc' },
    });
    if (!run) return null;
    const result = run.result as { suggestion?: AuthenticityOutcome; confidence?: number };
    if (!result?.suggestion) return null;
    if (result.suggestion === humanOutcome) return null;
    const conf = typeof result.confidence === 'number' ? ` (${(result.confidence * 100).toFixed(0)}%)` : '';
    return `AI suggested ${result.suggestion}${conf}; human overrode to ${humanOutcome} [run:${run.id}]`;
  }
}
