import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { newId } from '../../common/id';
import { MediaService } from '../media/media.service';
import { AuditService } from '../audit/audit.service';
import type { SellerComplianceDocDto, ComplianceDocStatus } from '@onsective/shared-types';
import type { UploadComplianceDocDto, ReviewComplianceDocDto } from './dto';

const MAX_DOC_BYTES = 4 * 1024 * 1024; // 4MB; checked after base64 decode

@Injectable()
export class SellerDocsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly media: MediaService,
    private readonly audit: AuditService,
  ) {}

  async upload(userId: string, dto: UploadComplianceDocDto): Promise<SellerComplianceDocDto> {
    const seller = await this.prisma.seller.findUnique({ where: { userId } });
    if (!seller) throw new NotFoundException('Seller profile required');

    const buf = Buffer.from(dto.fileBase64, 'base64');
    if (buf.length === 0) throw new BadRequestException('Empty file');
    if (buf.length > MAX_DOC_BYTES) {
      throw new BadRequestException(`Doc exceeds ${MAX_DOC_BYTES} bytes`);
    }

    if (dto.categoryId) {
      const cat = await this.prisma.category.findUnique({ where: { id: dto.categoryId } });
      if (!cat) throw new BadRequestException('Unknown category');
    }

    const safeName = dto.fileName.replace(/[^a-zA-Z0-9._-]/g, '_').slice(0, 120);
    const key = `compliance/${seller.id}/${newId()}-${safeName}`;
    const contentType = guessContentType(safeName);
    await this.media.putObject(key, buf, contentType);

    const created = await this.prisma.sellerComplianceDoc.create({
      data: {
        id: newId(),
        sellerId: seller.id,
        categoryId: dto.categoryId ?? null,
        docType: dto.docType,
        fileObjectKey: key,
        fileSizeBytes: buf.length,
        status: 'PENDING',
      },
    });

    await this.audit.record({
      actorUserId: userId,
      action: 'compliance.doc.upload',
      entityType: 'SellerComplianceDoc',
      entityId: created.id,
      after: { docType: created.docType, categoryId: created.categoryId, size: created.fileSizeBytes },
    });

    return this.toDto(created, seller.displayName, null, null);
  }

  async listMine(userId: string): Promise<SellerComplianceDocDto[]> {
    const seller = await this.prisma.seller.findUnique({ where: { userId } });
    if (!seller) return [];
    const rows = await this.prisma.sellerComplianceDoc.findMany({
      where: { sellerId: seller.id },
      include: { category: true },
      orderBy: { createdAt: 'desc' },
    });
    return rows.map((r) =>
      this.toDto(r, seller.displayName, r.category?.id ?? null, r.category?.slug ?? null),
    );
  }

  async listPending(): Promise<SellerComplianceDocDto[]> {
    const rows = await this.prisma.sellerComplianceDoc.findMany({
      where: { status: 'PENDING' },
      include: { seller: true, category: true },
      orderBy: { createdAt: 'asc' },
      take: 200,
    });
    return rows.map((r) =>
      this.toDto(r, r.seller.displayName, r.category?.id ?? null, r.category?.slug ?? null),
    );
  }

  async review(
    actorUserId: string,
    docId: string,
    dto: ReviewComplianceDocDto,
  ): Promise<SellerComplianceDocDto> {
    const doc = await this.prisma.sellerComplianceDoc.findUnique({
      where: { id: docId },
      include: { seller: true, category: true },
    });
    if (!doc) throw new NotFoundException('Doc not found');
    if (doc.status !== 'PENDING') {
      throw new BadRequestException(`Doc already ${doc.status}`);
    }

    const newStatus: ComplianceDocStatus = dto.approve ? 'APPROVED' : 'REJECTED';
    const expiresAt = dto.expiresAt ? new Date(dto.expiresAt) : null;
    if (!dto.approve && !dto.rejectionReason) {
      throw new BadRequestException('rejectionReason is required when rejecting');
    }

    const updated = await this.prisma.sellerComplianceDoc.update({
      where: { id: docId },
      data: {
        status: newStatus,
        reviewedAt: new Date(),
        reviewedByUserId: actorUserId,
        rejectionReason: dto.approve ? null : (dto.rejectionReason ?? null),
        expiresAt,
      },
      include: { seller: true, category: true },
    });

    await this.audit.record({
      actorUserId,
      action: dto.approve ? 'compliance.doc.approve' : 'compliance.doc.reject',
      entityType: 'SellerComplianceDoc',
      entityId: docId,
      before: { status: doc.status },
      after: { status: newStatus, rejectionReason: updated.rejectionReason, expiresAt: updated.expiresAt },
    });

    return this.toDto(
      updated,
      updated.seller.displayName,
      updated.category?.id ?? null,
      updated.category?.slug ?? null,
    );
  }

  /**
   * Returns true when the seller has at least one APPROVED, non-expired doc covering the category
   * (or a sellerwide doc with no categoryId). Used as a gate for compliance-restricted listings.
   */
  async sellerHasApprovedDocFor(sellerId: string, categoryId: string): Promise<boolean> {
    const now = new Date();
    const row = await this.prisma.sellerComplianceDoc.findFirst({
      where: {
        sellerId,
        status: 'APPROVED',
        OR: [{ categoryId }, { categoryId: null }],
        AND: [{ OR: [{ expiresAt: null }, { expiresAt: { gt: now } }] }],
      },
    });
    return !!row;
  }

  presignedView(key: string, ttlSec = 300) {
    return this.media.presignGetUrl(key, ttlSec);
  }

  async getPresignedViewUrl(docId: string, ttlSec = 300): Promise<string | null> {
    const doc = await this.prisma.sellerComplianceDoc.findUnique({
      where: { id: docId },
      select: { fileObjectKey: true },
    });
    if (!doc) return null;
    return this.media.presignGetUrl(doc.fileObjectKey, ttlSec);
  }

  private toDto(
    doc: any,
    sellerName: string | undefined,
    categoryId: string | null,
    categorySlug: string | null,
  ): SellerComplianceDocDto {
    return {
      id: doc.id,
      sellerId: doc.sellerId,
      sellerName,
      categoryId,
      categorySlug,
      docType: doc.docType,
      fileObjectKey: doc.fileObjectKey,
      fileSizeBytes: doc.fileSizeBytes,
      status: doc.status as ComplianceDocStatus,
      expiresAt: doc.expiresAt ? doc.expiresAt.toISOString() : null,
      reviewedAt: doc.reviewedAt ? doc.reviewedAt.toISOString() : null,
      rejectionReason: doc.rejectionReason ?? null,
      createdAt: doc.createdAt.toISOString(),
    };
  }
}

function guessContentType(name: string): string {
  const lower = name.toLowerCase();
  if (lower.endsWith('.pdf')) return 'application/pdf';
  if (lower.endsWith('.jpg') || lower.endsWith('.jpeg')) return 'image/jpeg';
  if (lower.endsWith('.png')) return 'image/png';
  if (lower.endsWith('.webp')) return 'image/webp';
  return 'application/octet-stream';
}
