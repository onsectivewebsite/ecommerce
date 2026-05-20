import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import {
  CertificationKind,
  CertificationStatus,
  type SellerCertification,
} from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { newId } from '../../common/id';
import { AuditService } from '../audit/audit.service';

interface ActorMeta {
  userId: string;
  ip?: string;
  userAgent?: string;
}

export interface CertificationDocument {
  url: string;
  label: string;
}

export interface ApplyCertificationInput {
  kind: CertificationKind;
  documents: CertificationDocument[];
  applicantNote?: string;
}

export interface ReviewCertificationInput {
  approve: boolean;
  reviewNote?: string;
  /** Renewal cadence. Default 12 months for APPROVE; ignored on reject. */
  validForMonths?: number;
}

const DEFAULT_VALID_MONTHS = 12;

@Injectable()
export class SellerCertificationsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly events: EventEmitter2,
    private readonly audit: AuditService,
  ) {}

  private async sellerOrThrow(userId: string) {
    const seller = await this.prisma.seller.findUnique({ where: { userId } });
    if (!seller) throw new NotFoundException('No seller profile');
    return seller;
  }

  /** Seller view: their own certifications. */
  async listMine(userId: string) {
    const seller = await this.sellerOrThrow(userId);
    return this.prisma.sellerCertification.findMany({
      where: { sellerId: seller.id },
      orderBy: { createdAt: 'desc' },
    });
  }

  async apply(userId: string, input: ApplyCertificationInput, actor: ActorMeta) {
    const seller = await this.sellerOrThrow(userId);
    if (input.documents.length === 0) {
      throw new BadRequestException('At least one supporting document is required');
    }
    // Upsert — re-applying after rejection moves it back to PENDING.
    const existing = await this.prisma.sellerCertification.findUnique({
      where: { sellerId_kind: { sellerId: seller.id, kind: input.kind } },
    });
    if (existing && existing.status === CertificationStatus.ACTIVE) {
      throw new BadRequestException('You already hold an active certification of this kind');
    }
    const data = {
      documents: input.documents as unknown as object,
      applicantNote: input.applicantNote ?? null,
      status: CertificationStatus.PENDING,
      reviewedBy: null,
      reviewedAt: null,
      reviewNote: null,
      expiresAt: null,
    };
    const row = existing
      ? await this.prisma.sellerCertification.update({
          where: { id: existing.id },
          data,
        })
      : await this.prisma.sellerCertification.create({
          data: {
            id: newId(),
            sellerId: seller.id,
            kind: input.kind,
            ...data,
          },
        });
    await this.audit.record({
      actorUserId: actor.userId,
      action: 'certification.apply',
      entityType: 'SellerCertification',
      entityId: row.id,
      after: { sellerId: seller.id, kind: input.kind },
      ip: actor.ip,
      userAgent: actor.userAgent,
    });
    this.events.emit('certification.applied', { sellerId: seller.id, kind: input.kind, id: row.id });
    return row;
  }

  /** Admin queue: pending applications. */
  listPending() {
    return this.prisma.sellerCertification.findMany({
      where: { status: CertificationStatus.PENDING },
      orderBy: { createdAt: 'asc' },
      include: {
        seller: { select: { id: true, storeName: true, displayName: true, userId: true } },
      },
    });
  }

  listAll(filter: { status?: CertificationStatus; sellerId?: string } = {}) {
    return this.prisma.sellerCertification.findMany({
      where: { status: filter.status, sellerId: filter.sellerId },
      orderBy: { createdAt: 'desc' },
      include: {
        seller: { select: { id: true, storeName: true, displayName: true } },
      },
    });
  }

  async review(id: string, input: ReviewCertificationInput, actor: ActorMeta) {
    const existing = await this.prisma.sellerCertification.findUnique({ where: { id } });
    if (!existing) throw new NotFoundException('Certification not found');
    if (existing.status !== CertificationStatus.PENDING) {
      throw new BadRequestException('Only PENDING certifications can be reviewed');
    }
    const months = input.validForMonths ?? DEFAULT_VALID_MONTHS;
    const expiresAt = input.approve
      ? new Date(Date.now() + months * 30 * 24 * 60 * 60 * 1000)
      : null;
    const updated = await this.prisma.sellerCertification.update({
      where: { id },
      data: {
        status: input.approve ? CertificationStatus.ACTIVE : CertificationStatus.REJECTED,
        reviewedBy: actor.userId,
        reviewedAt: new Date(),
        reviewNote: input.reviewNote ?? null,
        expiresAt,
      },
    });
    await this.audit.record({
      actorUserId: actor.userId,
      action: input.approve ? 'certification.approve' : 'certification.reject',
      entityType: 'SellerCertification',
      entityId: id,
      before: existing,
      after: updated,
      ip: actor.ip,
      userAgent: actor.userAgent,
    });
    this.events.emit(
      input.approve ? 'certification.approved' : 'certification.rejected',
      { sellerId: existing.sellerId, kind: existing.kind, id },
    );
    return updated;
  }

  async revoke(id: string, reason: string, actor: ActorMeta) {
    const existing = await this.prisma.sellerCertification.findUnique({ where: { id } });
    if (!existing) throw new NotFoundException('Certification not found');
    if (existing.status !== CertificationStatus.ACTIVE) {
      throw new BadRequestException('Only ACTIVE certifications can be revoked');
    }
    const updated = await this.prisma.sellerCertification.update({
      where: { id },
      data: {
        status: CertificationStatus.REVOKED,
        reviewNote: reason,
        reviewedBy: actor.userId,
        reviewedAt: new Date(),
      },
    });
    await this.audit.record({
      actorUserId: actor.userId,
      action: 'certification.revoke',
      entityType: 'SellerCertification',
      entityId: id,
      before: existing,
      after: updated,
      ip: actor.ip,
      userAgent: actor.userAgent,
    });
    this.events.emit('certification.revoked', {
      sellerId: existing.sellerId,
      kind: existing.kind,
      id,
    });
    return updated;
  }

  /**
   * Returns ACTIVE certifications for a seller, after marking any that have
   * passed their expiry as EXPIRED. Cheap inline check — keeps the publish
   * gate honest without depending on a scheduled job.
   */
  async listActiveForSeller(sellerId: string): Promise<SellerCertification[]> {
    const rows = await this.prisma.sellerCertification.findMany({
      where: { sellerId, status: CertificationStatus.ACTIVE },
    });
    const now = Date.now();
    const active: SellerCertification[] = [];
    for (const r of rows) {
      if (r.expiresAt && r.expiresAt.getTime() <= now) {
        await this.prisma.sellerCertification.update({
          where: { id: r.id },
          data: { status: CertificationStatus.EXPIRED },
        });
      } else {
        active.push(r);
      }
    }
    return active;
  }

  async hasActive(sellerId: string, kind: CertificationKind): Promise<boolean> {
    const rows = await this.listActiveForSeller(sellerId);
    return rows.some((r) => r.kind === kind);
  }

  async assertHasActive(sellerId: string, kind: CertificationKind): Promise<void> {
    if (!(await this.hasActive(sellerId, kind))) {
      throw new ForbiddenException(
        `Seller is not certified as ${kind}. Apply for certification first.`,
      );
    }
  }
}
