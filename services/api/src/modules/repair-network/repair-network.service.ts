import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import {
  RepairPartnerStatus,
  ServiceTicketEventKind,
  ServiceTicketStatus,
  WarrantyClaimStatus,
} from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { newId } from '../../common/id';
import { AuditService } from '../audit/audit.service';

interface ActorMeta {
  userId: string;
  ip?: string;
  userAgent?: string;
}

export interface CreatePartnerInput {
  userId: string;
  displayName: string;
  capabilityCategorySlugs?: string[];
  dailyCapacity?: number;
  turnaroundHours?: number;
  serviceLine1?: string;
  serviceCity?: string;
  serviceRegion?: string;
  servicePostal?: string;
  serviceCountry?: string;
  notes?: string;
}

export interface UpdatePartnerInput {
  displayName?: string;
  status?: RepairPartnerStatus;
  capabilityCategorySlugs?: string[];
  dailyCapacity?: number;
  turnaroundHours?: number;
  notes?: string;
}

export interface UpdateTicketInput {
  status?: ServiceTicketStatus;
  partnerNote?: string;
  estimatedPartsCostMinor?: number;
  currency?: string;
  inboundCarrier?: string;
  inboundTracking?: string;
  outboundCarrier?: string;
  outboundTracking?: string;
}

// Forward-only transitions allowed for partners. Admin can move anywhere.
const FORWARD_ORDER: ServiceTicketStatus[] = [
  ServiceTicketStatus.CREATED,
  ServiceTicketStatus.ASSIGNED,
  ServiceTicketStatus.INBOUND,
  ServiceTicketStatus.RECEIVED,
  ServiceTicketStatus.DIAGNOSING,
  ServiceTicketStatus.REPAIRING,
  ServiceTicketStatus.OUTBOUND,
  ServiceTicketStatus.COMPLETED,
];

@Injectable()
export class RepairNetworkService {
  private readonly logger = new Logger(RepairNetworkService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly events: EventEmitter2,
    private readonly audit: AuditService,
  ) {}

  // ---------------- partners (admin) ----------------

  listPartners() {
    return this.prisma.repairPartner.findMany({
      orderBy: [{ status: 'asc' }, { displayName: 'asc' }],
      include: { _count: { select: { tickets: true } } },
    });
  }

  async createPartner(input: CreatePartnerInput, actor: ActorMeta) {
    const user = await this.prisma.user.findUnique({ where: { id: input.userId } });
    if (!user) throw new BadRequestException('User not found');
    const dup = await this.prisma.repairPartner.findUnique({ where: { userId: input.userId } });
    if (dup) throw new ConflictException('User already linked to a repair partner');
    const created = await this.prisma.repairPartner.create({
      data: {
        id: newId(),
        userId: input.userId,
        displayName: input.displayName,
        capabilityCategorySlugs: input.capabilityCategorySlugs ?? [],
        dailyCapacity: input.dailyCapacity ?? 20,
        turnaroundHours: input.turnaroundHours ?? 72,
        serviceLine1: input.serviceLine1 ?? null,
        serviceCity: input.serviceCity ?? null,
        serviceRegion: input.serviceRegion ?? null,
        servicePostal: input.servicePostal ?? null,
        serviceCountry: input.serviceCountry?.toUpperCase() ?? null,
        notes: input.notes ?? null,
      },
    });
    await this.audit.record({
      actorUserId: actor.userId,
      action: 'repair.partner.create',
      entityType: 'RepairPartner',
      entityId: created.id,
      after: { userId: input.userId, displayName: input.displayName },
      ip: actor.ip,
      userAgent: actor.userAgent,
    });
    return created;
  }

  async updatePartner(id: string, patch: UpdatePartnerInput, actor: ActorMeta) {
    const before = await this.prisma.repairPartner.findUnique({ where: { id } });
    if (!before) throw new NotFoundException('Partner not found');
    const updated = await this.prisma.repairPartner.update({
      where: { id },
      data: {
        displayName: patch.displayName ?? undefined,
        status: patch.status ?? undefined,
        capabilityCategorySlugs: patch.capabilityCategorySlugs ?? undefined,
        dailyCapacity: patch.dailyCapacity ?? undefined,
        turnaroundHours: patch.turnaroundHours ?? undefined,
        notes: patch.notes === undefined ? undefined : patch.notes,
      },
    });
    await this.audit.record({
      actorUserId: actor.userId,
      action: 'repair.partner.update',
      entityType: 'RepairPartner',
      entityId: id,
      before, after: updated,
      ip: actor.ip, userAgent: actor.userAgent,
    });
    return updated;
  }

  // ---------------- routing ----------------

  /**
   * Pick the best ACTIVE partner whose capabilities include the product
   * category and whose current open-ticket count is below capacity.
   * Returns null if nobody qualifies — caller writes an unassigned ticket.
   */
  private async routePartner(categorySlug: string): Promise<{ id: string } | null> {
    const candidates = await this.prisma.repairPartner.findMany({
      where: {
        status: RepairPartnerStatus.ACTIVE,
        capabilityCategorySlugs: { has: categorySlug },
      },
      orderBy: [{ turnaroundHours: 'asc' }, { id: 'asc' }],
    });
    if (candidates.length === 0) return null;
    // Filter by open-ticket count vs dailyCapacity.
    const openCounts = await this.prisma.serviceTicket.groupBy({
      by: ['partnerId'],
      where: {
        partnerId: { in: candidates.map((c) => c.id) },
        status: { in: [
          ServiceTicketStatus.ASSIGNED, ServiceTicketStatus.INBOUND,
          ServiceTicketStatus.RECEIVED, ServiceTicketStatus.DIAGNOSING,
          ServiceTicketStatus.REPAIRING, ServiceTicketStatus.OUTBOUND,
        ] },
      },
      _count: { _all: true },
    });
    const used = new Map(openCounts.map((o) => [o.partnerId!, o._count._all]));
    for (const c of candidates) {
      if ((used.get(c.id) ?? 0) < c.dailyCapacity) {
        return { id: c.id };
      }
    }
    return null;
  }

  // ---------------- ticket lifecycle ----------------

  /**
   * Called from WarrantyService.resolve when status = RESOLVED_REPAIR.
   * Always writes a ticket (even unassigned) so the warranty resolution
   * never fails because routing came up empty.
   */
  async createTicketFromClaim(warrantyClaimId: string, actor: ActorMeta) {
    const claim = await this.prisma.warrantyClaim.findUnique({
      where: { id: warrantyClaimId },
      include: {
        orderItem: { include: { variant: { include: { product: { include: { category: true } } } } } },
      },
    });
    if (!claim) throw new NotFoundException('Warranty claim not found');
    const existing = await this.prisma.serviceTicket.findUnique({ where: { warrantyClaimId } });
    if (existing) return existing;

    const categorySlug = claim.orderItem.variant.product.category.slug;
    const partner = await this.routePartner(categorySlug);

    const ticketId = newId();
    const ticket = await this.prisma.$transaction(async (tx) => {
      const t = await tx.serviceTicket.create({
        data: {
          id: ticketId,
          warrantyClaimId,
          partnerId: partner?.id ?? null,
          status: partner ? ServiceTicketStatus.ASSIGNED : ServiceTicketStatus.CREATED,
          buyerNote: claim.symptom,
        },
      });
      await tx.serviceTicketEvent.create({
        data: {
          id: newId(),
          ticketId: t.id,
          kind: partner ? ServiceTicketEventKind.ASSIGNED : ServiceTicketEventKind.STATUS_CHANGED,
          actorUserId: actor.userId,
          payload: { partnerId: partner?.id ?? null, status: t.status } as object,
        },
      });
      return t;
    });

    await this.audit.record({
      actorUserId: actor.userId,
      action: 'repair.ticket.create',
      entityType: 'ServiceTicket',
      entityId: ticket.id,
      after: { warrantyClaimId, partnerId: partner?.id ?? null },
      ip: actor.ip, userAgent: actor.userAgent,
    });
    this.events.emit('repair.ticket.created', { ticketId: ticket.id, partnerId: partner?.id ?? null });
    return ticket;
  }

  /** Admin manual route — used when the auto-route picked null. */
  async adminAssignPartner(ticketId: string, partnerId: string, actor: ActorMeta) {
    const ticket = await this.prisma.serviceTicket.findUnique({ where: { id: ticketId } });
    if (!ticket) throw new NotFoundException('Ticket not found');
    const partner = await this.prisma.repairPartner.findUnique({ where: { id: partnerId } });
    if (!partner) throw new NotFoundException('Partner not found');
    const updated = await this.prisma.$transaction(async (tx) => {
      const t = await tx.serviceTicket.update({
        where: { id: ticketId },
        data: {
          partnerId,
          status: ticket.status === ServiceTicketStatus.CREATED
            ? ServiceTicketStatus.ASSIGNED
            : ticket.status,
        },
      });
      await tx.serviceTicketEvent.create({
        data: {
          id: newId(),
          ticketId,
          kind: ticket.partnerId ? ServiceTicketEventKind.REASSIGNED : ServiceTicketEventKind.ASSIGNED,
          actorUserId: actor.userId,
          payload: { from: ticket.partnerId, to: partnerId } as object,
        },
      });
      return t;
    });
    return updated;
  }

  /**
   * Partner update path. Enforces forward-only transitions.
   */
  async partnerUpdateTicket(
    userId: string,
    ticketId: string,
    patch: UpdateTicketInput,
    actor: ActorMeta,
  ) {
    const partner = await this.prisma.repairPartner.findUnique({ where: { userId } });
    if (!partner) throw new ForbiddenException('Not a repair partner');
    if (partner.status !== RepairPartnerStatus.ACTIVE) {
      throw new ForbiddenException('Partner is not active');
    }
    const ticket = await this.prisma.serviceTicket.findUnique({ where: { id: ticketId } });
    if (!ticket || ticket.partnerId !== partner.id) throw new NotFoundException('Ticket not found');
    if (ticket.status === ServiceTicketStatus.COMPLETED || ticket.status === ServiceTicketStatus.CANCELLED) {
      throw new BadRequestException('Ticket already finalized');
    }
    if (patch.status) {
      const fromIdx = FORWARD_ORDER.indexOf(ticket.status);
      const toIdx = FORWARD_ORDER.indexOf(patch.status);
      if (fromIdx < 0 || toIdx < 0 || toIdx <= fromIdx) {
        throw new BadRequestException(
          `Partners can only move tickets forward (current=${ticket.status}, requested=${patch.status})`,
        );
      }
    }
    return this.applyTicketUpdate(ticket.id, patch, actor, /* isPartner */ true);
  }

  /** Admin update path — can move backward, cancel, reassign. */
  async adminUpdateTicket(ticketId: string, patch: UpdateTicketInput, actor: ActorMeta) {
    const ticket = await this.prisma.serviceTicket.findUnique({ where: { id: ticketId } });
    if (!ticket) throw new NotFoundException('Ticket not found');
    return this.applyTicketUpdate(ticket.id, patch, actor, /* isPartner */ false);
  }

  private async applyTicketUpdate(
    ticketId: string,
    patch: UpdateTicketInput,
    actor: ActorMeta,
    isPartner: boolean,
  ) {
    const before = await this.prisma.serviceTicket.findUniqueOrThrow({ where: { id: ticketId } });
    const updated = await this.prisma.$transaction(async (tx) => {
      const t = await tx.serviceTicket.update({
        where: { id: ticketId },
        data: {
          status: patch.status ?? undefined,
          partnerNote: patch.partnerNote === undefined ? undefined : patch.partnerNote,
          estimatedPartsCostMinor:
            patch.estimatedPartsCostMinor === undefined ? undefined : patch.estimatedPartsCostMinor,
          currency: patch.currency === undefined ? undefined : patch.currency,
          inboundCarrier: patch.inboundCarrier === undefined ? undefined : patch.inboundCarrier,
          inboundTracking: patch.inboundTracking === undefined ? undefined : patch.inboundTracking,
          outboundCarrier: patch.outboundCarrier === undefined ? undefined : patch.outboundCarrier,
          outboundTracking: patch.outboundTracking === undefined ? undefined : patch.outboundTracking,
          completedAt: patch.status === ServiceTicketStatus.COMPLETED ? new Date() : undefined,
        },
      });
      if (patch.status && patch.status !== before.status) {
        await tx.serviceTicketEvent.create({
          data: {
            id: newId(),
            ticketId,
            kind: patch.status === ServiceTicketStatus.COMPLETED
              ? ServiceTicketEventKind.COMPLETED
              : ServiceTicketEventKind.STATUS_CHANGED,
            actorUserId: actor.userId,
            payload: { from: before.status, to: patch.status } as object,
          },
        });
      } else if (patch.partnerNote && patch.partnerNote !== before.partnerNote) {
        await tx.serviceTicketEvent.create({
          data: {
            id: newId(),
            ticketId,
            kind: ServiceTicketEventKind.NOTE_ADDED,
            actorUserId: actor.userId,
            note: patch.partnerNote,
          },
        });
      }
      // Phase 14 warranty closure: COMPLETED writes the underlying claim.
      if (patch.status === ServiceTicketStatus.COMPLETED) {
        const claim = await tx.warrantyClaim.findUnique({ where: { id: t.warrantyClaimId } });
        if (claim && (claim.status === WarrantyClaimStatus.OPEN || claim.status === WarrantyClaimStatus.APPROVED)) {
          await tx.warrantyClaim.update({
            where: { id: claim.id },
            data: {
              status: WarrantyClaimStatus.RESOLVED_REPAIR,
              resolvedBy: actor.userId,
              resolvedAt: new Date(),
              resolutionRef: `ticket:${t.id}`,
            },
          });
        }
      }
      return t;
    });

    await this.audit.record({
      actorUserId: actor.userId,
      action: isPartner ? 'repair.ticket.partner-update' : 'repair.ticket.admin-update',
      entityType: 'ServiceTicket',
      entityId: ticketId,
      before, after: updated,
      ip: actor.ip, userAgent: actor.userAgent,
    });

    if (patch.status === ServiceTicketStatus.COMPLETED) {
      this.events.emit('repair.ticket.completed', { ticketId, warrantyClaimId: updated.warrantyClaimId });
    }
    return updated;
  }

  async cancel(ticketId: string, reason: string, actor: ActorMeta) {
    const before = await this.prisma.serviceTicket.findUnique({ where: { id: ticketId } });
    if (!before) throw new NotFoundException('Ticket not found');
    if (before.status === ServiceTicketStatus.COMPLETED || before.status === ServiceTicketStatus.CANCELLED) {
      throw new BadRequestException('Ticket already finalized');
    }
    const updated = await this.prisma.$transaction(async (tx) => {
      const t = await tx.serviceTicket.update({
        where: { id: ticketId },
        data: {
          status: ServiceTicketStatus.CANCELLED,
          cancelledAt: new Date(),
          cancelledReason: reason,
        },
      });
      await tx.serviceTicketEvent.create({
        data: {
          id: newId(),
          ticketId,
          kind: ServiceTicketEventKind.CANCELLED,
          actorUserId: actor.userId,
          note: reason,
        },
      });
      return t;
    });
    await this.audit.record({
      actorUserId: actor.userId,
      action: 'repair.ticket.cancel',
      entityType: 'ServiceTicket',
      entityId: ticketId,
      before, after: updated,
      ip: actor.ip, userAgent: actor.userAgent,
    });
    return updated;
  }

  // ---------------- queries ----------------

  /** Admin: all tickets + counts. */
  adminListTickets(limit = 100) {
    return this.prisma.serviceTicket.findMany({
      orderBy: { updatedAt: 'desc' },
      take: Math.min(500, limit),
      include: {
        partner: { select: { id: true, displayName: true } },
        warrantyClaim: {
          select: {
            id: true, symptom: true, claimantUserId: true,
            orderItem: { select: { productTitleSnapshot: true } },
          },
        },
      },
    });
  }

  /** Admin: tickets that need manual routing. */
  adminUnassigned() {
    return this.prisma.serviceTicket.findMany({
      where: { partnerId: null, status: ServiceTicketStatus.CREATED },
      orderBy: { createdAt: 'asc' },
      include: {
        warrantyClaim: {
          select: {
            symptom: true,
            orderItem: { select: { productTitleSnapshot: true, variant: { select: { product: { select: { category: { select: { slug: true } } } } } } } },
          },
        },
      },
    });
  }

  /** Partner queue — scoped to the requesting user. */
  async partnerQueue(userId: string) {
    const partner = await this.prisma.repairPartner.findUnique({ where: { userId } });
    if (!partner) throw new ForbiddenException('Not a repair partner');
    return this.prisma.serviceTicket.findMany({
      where: {
        partnerId: partner.id,
        status: { notIn: [ServiceTicketStatus.COMPLETED, ServiceTicketStatus.CANCELLED] },
      },
      orderBy: { createdAt: 'asc' },
      include: {
        warrantyClaim: {
          select: {
            symptom: true,
            orderItem: { select: { productTitleSnapshot: true } },
          },
        },
        events: { orderBy: { createdAt: 'desc' }, take: 5 },
      },
    });
  }

  /** Buyer-side per-claim ticket fetch. */
  ticketForClaim(warrantyClaimId: string) {
    return this.prisma.serviceTicket.findUnique({
      where: { warrantyClaimId },
      include: {
        partner: { select: { id: true, displayName: true, turnaroundHours: true } },
        events: { orderBy: { createdAt: 'desc' }, take: 10 },
      },
    });
  }
}
