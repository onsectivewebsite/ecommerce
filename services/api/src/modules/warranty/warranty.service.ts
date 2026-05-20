import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import {
  ProductCondition,
  WarrantyClaimStatus,
} from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { newId } from '../../common/id';
import { AuditService } from '../audit/audit.service';
import { WalletService } from '../wallet/wallet.service';
import { RepairNetworkService } from '../repair-network/repair-network.service';
import { MembershipService } from '../loyalty/membership.service';

interface ActorMeta {
  userId: string;
  ip?: string;
  userAgent?: string;
}

export interface FileClaimInput {
  orderItemId: string;
  symptom: string;
  evidence: Array<{ url: string; kind: 'PHOTO' | 'VIDEO' | 'NOTE'; note?: string }>;
}

export interface ResolveClaimInput {
  status:
    | WarrantyClaimStatus.RESOLVED_REPAIR
    | WarrantyClaimStatus.RESOLVED_REPLACE
    | WarrantyClaimStatus.RESOLVED_REFUND
    | WarrantyClaimStatus.REJECTED;
  resolutionNote?: string;
  /** For RESOLVED_REPLACE — id of the replacement RefurbUnit. */
  replacementRefurbUnitId?: string;
  /** For RESOLVED_REFUND — amount in minor units; defaults to line price. */
  refundAmountMinor?: number;
}

function warrantyMonthsFor(condition: ProductCondition): number {
  switch (condition) {
    case ProductCondition.REFURB_GRADE_A:
      return 12;
    case ProductCondition.REFURB_GRADE_B:
      return 6;
    case ProductCondition.REFURB_GRADE_C:
      return 1;
    default:
      // NEW_GENUINE is manufacturer-covered; we surface terms but do not
      // run platform-backed claims. Allow claim opening for triage only.
      return 0;
  }
}

@Injectable()
export class WarrantyService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly events: EventEmitter2,
    private readonly audit: AuditService,
    private readonly wallet: WalletService,
    private readonly repair: RepairNetworkService,
    private readonly membership: MembershipService,
  ) {}

  // ---------- buyer ----------

  async file(buyerUserId: string, input: FileClaimInput, actor: ActorMeta) {
    const item = await this.prisma.orderItem.findUnique({
      where: { id: input.orderItemId },
      include: {
        order: {
          select: {
            userId: true,
            sellerId: true,
            status: true,
            createdAt: true,
            shipment: { select: { deliveredAt: true } },
          },
        },
        variant: { include: { product: { select: { condition: true, title: true } } } },
        refurbUnit: true,
      },
    });
    if (!item) throw new NotFoundException('Order item not found');
    if (item.order.userId !== buyerUserId) throw new ForbiddenException();
    if (item.order.status === 'CANCELLED') {
      throw new BadRequestException('Cannot file a warranty claim on a cancelled order');
    }
    const condition = item.variant.product.condition;
    const baseMonths = item.refurbUnit?.warrantyMonths ?? warrantyMonthsFor(condition);

    // Phase 22 — Plus members get +3 months on refurb warranty (clamped at
    // 24), evaluated against membership status as of purchase time. We don't
    // snapshot this onto OrderItem because membership history + order
    // createdAt is enough to derive it on demand.
    let months = baseMonths;
    if (baseMonths > 0) {
      const wasPlusAtPurchase = await this.membership.wasActiveAt(
        buyerUserId,
        item.order.createdAt,
      );
      if (wasPlusAtPurchase) {
        months = Math.min(24, baseMonths + 3);
      }
    }

    // Window check: refurb units have a finite platform-backed window.
    if (months > 0) {
      const windowMs = months * 30 * 24 * 60 * 60 * 1000;
      const start = item.order.shipment?.deliveredAt ?? item.order.createdAt;
      if (Date.now() - start.getTime() > windowMs) {
        throw new BadRequestException(`Platform warranty window of ${months} month(s) has passed`);
      }
    }
    if (input.symptom.trim().length < 10) {
      throw new BadRequestException('Please describe the symptom in detail');
    }
    if (input.evidence.length === 0) {
      throw new BadRequestException('At least one photo/video/note required');
    }

    const created = await this.prisma.warrantyClaim.create({
      data: {
        id: newId(),
        orderItemId: input.orderItemId,
        claimantUserId: buyerUserId,
        symptom: input.symptom,
        evidence: input.evidence as unknown as object,
        status: WarrantyClaimStatus.OPEN,
      },
    });
    await this.audit.record({
      actorUserId: actor.userId,
      action: 'warranty.file',
      entityType: 'WarrantyClaim',
      entityId: created.id,
      after: { orderItemId: input.orderItemId },
      ip: actor.ip,
      userAgent: actor.userAgent,
    });
    this.events.emit('warranty.filed', {
      claimId: created.id,
      orderItemId: input.orderItemId,
      sellerId: item.order.sellerId,
    });
    return created;
  }

  async listForBuyer(buyerUserId: string) {
    return this.prisma.warrantyClaim.findMany({
      where: { claimantUserId: buyerUserId },
      orderBy: { createdAt: 'desc' },
      include: {
        orderItem: {
          include: { variant: { include: { product: { select: { title: true, slug: true } } } } },
        },
      },
    });
  }

  // ---------- admin ----------

  listOpen() {
    return this.prisma.warrantyClaim.findMany({
      where: { status: { in: [WarrantyClaimStatus.OPEN, WarrantyClaimStatus.APPROVED] } },
      orderBy: { createdAt: 'asc' },
      include: {
        orderItem: {
          include: {
            order: { select: { id: true, sellerId: true } },
            variant: { include: { product: { select: { title: true, slug: true, condition: true } } } },
            refurbUnit: true,
          },
        },
        claimant: { select: { id: true, email: true } },
      },
    });
  }

  async approve(id: string, note: string | undefined, actor: ActorMeta) {
    const existing = await this.prisma.warrantyClaim.findUnique({ where: { id } });
    if (!existing) throw new NotFoundException('Claim not found');
    if (existing.status !== WarrantyClaimStatus.OPEN) {
      throw new BadRequestException('Only OPEN claims can be approved');
    }
    const updated = await this.prisma.warrantyClaim.update({
      where: { id },
      data: {
        status: WarrantyClaimStatus.APPROVED,
        resolutionNote: note ?? null,
        resolvedBy: actor.userId,
      },
    });
    await this.audit.record({
      actorUserId: actor.userId,
      action: 'warranty.approve',
      entityType: 'WarrantyClaim',
      entityId: id,
      before: existing,
      after: updated,
      ip: actor.ip,
      userAgent: actor.userAgent,
    });
    return updated;
  }

  async resolve(id: string, input: ResolveClaimInput, actor: ActorMeta) {
    const claim = await this.prisma.warrantyClaim.findUnique({
      where: { id },
      include: {
        orderItem: {
          include: {
            order: { select: { id: true, sellerId: true, userId: true, currency: true } },
            refurbUnit: true,
          },
        },
      },
    });
    if (!claim) throw new NotFoundException('Claim not found');
    if (
      claim.status !== WarrantyClaimStatus.OPEN &&
      claim.status !== WarrantyClaimStatus.APPROVED
    ) {
      throw new BadRequestException('Only OPEN/APPROVED claims can be resolved');
    }
    if (input.status === WarrantyClaimStatus.RESOLVED_REPLACE && !input.replacementRefurbUnitId) {
      throw new BadRequestException('replacementRefurbUnitId required for RESOLVED_REPLACE');
    }

    let resolutionRef: string | null = null;

    if (input.status === WarrantyClaimStatus.RESOLVED_REFUND) {
      const refundMinor =
        input.refundAmountMinor ?? claim.orderItem.lineSubtotalMinor;
      // Push as wallet credit — keeps it simple and uses the existing path
      // rather than racing payment-processor refunds for an aged order.
      await this.wallet.creditFromWarranty(
        claim.orderItem.order.userId,
        refundMinor,
        claim.orderItem.order.currency,
        claim.id,
      );
      resolutionRef = `wallet:${refundMinor}`;
      // Warranty refund signals a missed defect — flag seller health.
      this.events.emit('warranty.seller-defect', {
        sellerId: claim.orderItem.order.sellerId,
        claimId: claim.id,
      });
    } else if (input.status === WarrantyClaimStatus.RESOLVED_REPLACE) {
      // Mark the replacement unit RESERVED for warranty fulfillment. The
      // shipping flow picks it up via the resolutionRef.
      const replacement = await this.prisma.refurbUnit.findUnique({
        where: { id: input.replacementRefurbUnitId! },
      });
      if (!replacement) throw new NotFoundException('Replacement unit not found');
      if (replacement.availability !== 'AVAILABLE') {
        throw new BadRequestException('Replacement unit is not available');
      }
      await this.prisma.refurbUnit.update({
        where: { id: replacement.id },
        data: {
          availability: 'RESERVED',
          reservedByCartId: `warranty:${claim.id}`,
          reservedUntil: new Date(Date.now() + 14 * 24 * 60 * 60 * 1000),
        },
      });
      resolutionRef = `refurb:${replacement.id}`;
    } else if (input.status === WarrantyClaimStatus.RESOLVED_REPAIR) {
      // Phase 19: auto-create the service ticket and route to a partner.
      // Routing is best-effort — an unassigned ticket is still created so
      // the warranty resolution doesn't fail.
      const ticket = await this.repair.createTicketFromClaim(claim.id, actor);
      resolutionRef = `ticket:${ticket.id}`;
    }

    const updated = await this.prisma.warrantyClaim.update({
      where: { id },
      data: {
        status: input.status,
        resolutionNote: input.resolutionNote ?? null,
        resolvedBy: actor.userId,
        resolvedAt: new Date(),
        resolutionRef,
      },
    });
    await this.audit.record({
      actorUserId: actor.userId,
      action: `warranty.${input.status.toLowerCase()}`,
      entityType: 'WarrantyClaim',
      entityId: id,
      before: claim,
      after: updated,
      ip: actor.ip,
      userAgent: actor.userAgent,
    });
    this.events.emit('warranty.resolved', { claimId: id, status: input.status });
    return updated;
  }
}
