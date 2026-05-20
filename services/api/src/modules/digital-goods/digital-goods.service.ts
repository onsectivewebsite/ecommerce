import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { createHash } from 'crypto';
import { PrismaService } from '../../prisma/prisma.service';
import { newId } from '../../common/id';
import { MediaService } from '../media/media.service';
import { AuditService } from '../audit/audit.service';
import { KeyCrypto } from './key-crypto';
import type {
  DigitalProductDto,
  DigitalGoodType,
  ImportLicenseKeysResultDto,
} from '@onsective/shared-types';
import type { UpsertDigitalProductDto } from './dto';

const MAX_DOWNLOAD_BYTES = 100 * 1024 * 1024; // 100MB single file cap

@Injectable()
export class DigitalGoodsService {
  private readonly logger = new Logger(DigitalGoodsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly media: MediaService,
    private readonly audit: AuditService,
    private readonly crypto: KeyCrypto,
  ) {}

  async getForSeller(userId: string, productId: string): Promise<DigitalProductDto | null> {
    const product = await this.ownProductOrThrow(userId, productId);
    const dp = await this.prisma.digitalProduct.findUnique({ where: { productId: product.id } });
    if (!dp) return null;
    const stats = await this.poolStats(dp.id);
    return this.toDto(dp, stats);
  }

  async upsert(userId: string, productId: string, dto: UpsertDigitalProductDto): Promise<DigitalProductDto> {
    const product = await this.ownProductOrThrow(userId, productId);
    let objectKey: string | null = null;
    let sizeBytes: number | null = null;
    let checksum: string | null = null;

    if (dto.type === 'FILE_DOWNLOAD') {
      if (!dto.fileBase64 || !dto.fileName) {
        // Allow keeping the existing file by skipping
        const existing = await this.prisma.digitalProduct.findUnique({ where: { productId: product.id } });
        if (!existing?.fileObjectKey) {
          throw new BadRequestException('FILE_DOWNLOAD requires fileBase64 + fileName on first save');
        }
      } else {
        const buf = Buffer.from(dto.fileBase64, 'base64');
        if (buf.length === 0) throw new BadRequestException('Empty file');
        if (buf.length > MAX_DOWNLOAD_BYTES) {
          throw new BadRequestException(`File exceeds ${MAX_DOWNLOAD_BYTES} bytes`);
        }
        const safe = dto.fileName.replace(/[^a-zA-Z0-9._-]/g, '_').slice(0, 120);
        objectKey = `digital/${product.id}/${newId()}-${safe}`;
        sizeBytes = buf.length;
        checksum = createHash('sha256').update(buf).digest('hex');
        await this.media.putObject(objectKey, buf, guessContentType(safe));
      }
    }

    const data = {
      type: dto.type,
      downloadLimit: dto.downloadLimit ?? 5,
      expiryDays: dto.expiryDays ?? 30,
      notesToBuyer: dto.notesToBuyer ?? null,
      ...(objectKey ? { fileObjectKey: objectKey, fileSizeBytes: sizeBytes!, fileChecksum: checksum } : {}),
    };

    const dp = await this.prisma.digitalProduct.upsert({
      where: { productId: product.id },
      create: { id: newId(), productId: product.id, ...data },
      update: data,
    });

    await this.prisma.product.update({
      where: { id: product.id },
      data: { isDigital: true },
    });

    await this.audit.record({
      actorUserId: userId,
      action: 'digital.product.upsert',
      entityType: 'DigitalProduct',
      entityId: dp.id,
      after: { type: dp.type, downloadLimit: dp.downloadLimit, expiryDays: dp.expiryDays },
    });

    const stats = await this.poolStats(dp.id);
    return this.toDto(dp, stats);
  }

  async importLicenseKeys(
    userId: string,
    productId: string,
    keys: string[],
  ): Promise<ImportLicenseKeysResultDto> {
    const product = await this.ownProductOrThrow(userId, productId);
    const dp = await this.prisma.digitalProduct.findUnique({ where: { productId: product.id } });
    if (!dp) throw new NotFoundException('Configure the product as digital first');
    if (dp.type !== 'LICENSE_KEY') {
      throw new BadRequestException('Product is not configured as LICENSE_KEY');
    }

    const cleaned = Array.from(
      new Set(
        keys
          .map((k) => k.trim())
          .filter((k) => k.length > 0 && k.length <= 512),
      ),
    );
    if (cleaned.length === 0) {
      throw new BadRequestException('No usable keys provided');
    }

    let inserted = 0;
    let skipped = 0;
    for (const k of cleaned) {
      const fingerprint = this.crypto.fingerprint(k);
      try {
        await this.prisma.licenseKey.create({
          data: {
            id: newId(),
            digitalProductId: dp.id,
            codeEncrypted: this.crypto.encrypt(k),
            codeFingerprint: fingerprint,
            status: 'AVAILABLE',
          },
        });
        inserted++;
      } catch (e: any) {
        // unique constraint violation on fingerprint → duplicate
        if (e?.code === 'P2002') {
          skipped++;
        } else {
          this.logger.error(`License import failed: ${e?.message}`);
          throw e;
        }
      }
    }

    await this.audit.record({
      actorUserId: userId,
      action: 'digital.license.import',
      entityType: 'DigitalProduct',
      entityId: dp.id,
      after: { inserted, skipped },
    });

    const stats = await this.poolStats(dp.id);
    return { inserted, skippedDuplicates: skipped, totalAvailable: stats.available };
  }

  async revealKeyForBuyer(userId: string, deliveryId: string): Promise<{ code: string }> {
    const delivery = await this.prisma.digitalDelivery.findUnique({
      where: { id: deliveryId },
      include: {
        orderItem: { include: { order: true } },
        licenseKey: true,
      },
    });
    if (!delivery) throw new NotFoundException('Delivery not found');
    if (delivery.orderItem.order.userId !== userId) {
      throw new ForbiddenException('Not your delivery');
    }
    if (!delivery.licenseKey) {
      throw new BadRequestException('This delivery has no license key (FILE_DOWNLOAD only)');
    }
    return { code: this.crypto.decrypt(delivery.licenseKey.codeEncrypted) };
  }

  async mintDownloadUrl(
    userId: string,
    deliveryId: string,
  ): Promise<{ url: string; expiresInSec: number; downloadsRemaining: number }> {
    const delivery = await this.prisma.digitalDelivery.findUnique({
      where: { id: deliveryId },
      include: {
        orderItem: { include: { order: true } },
        digitalProduct: true,
      },
    });
    if (!delivery) throw new NotFoundException('Delivery not found');
    if (delivery.orderItem.order.userId !== userId) {
      throw new ForbiddenException('Not your delivery');
    }
    if (delivery.digitalProduct.type !== 'FILE_DOWNLOAD') {
      throw new BadRequestException('This delivery is a license key, not a download');
    }
    if (!delivery.digitalProduct.fileObjectKey) {
      throw new NotFoundException('Underlying file is missing — contact the seller');
    }
    if (delivery.expiresAt.getTime() < Date.now()) {
      throw new ForbiddenException('Download window has expired');
    }
    const remaining = delivery.digitalProduct.downloadLimit - delivery.downloadCount;
    if (remaining <= 0) {
      throw new ForbiddenException('Download limit reached');
    }

    const ttl = 300;
    const url = this.media.presignGetUrl(delivery.digitalProduct.fileObjectKey, ttl);

    await this.prisma.digitalDelivery.update({
      where: { id: deliveryId },
      data: { downloadCount: { increment: 1 }, lastDownloadAt: new Date() },
    });

    return { url, expiresInSec: ttl, downloadsRemaining: remaining - 1 };
  }

  private async ownProductOrThrow(userId: string, productId: string) {
    const product = await this.prisma.product.findUnique({
      where: { id: productId },
      include: { seller: true },
    });
    if (!product) throw new NotFoundException('Product not found');
    if (product.seller.userId !== userId) {
      throw new ForbiddenException('Not your product');
    }
    return product;
  }

  private async poolStats(digitalProductId: string) {
    const grouped = await this.prisma.licenseKey.groupBy({
      by: ['status'],
      where: { digitalProductId },
      _count: { _all: true },
    });
    const out = { available: 0, assigned: 0, revoked: 0 };
    for (const g of grouped) {
      if (g.status === 'AVAILABLE') out.available = g._count._all;
      else if (g.status === 'ASSIGNED') out.assigned = g._count._all;
      else if (g.status === 'REVOKED') out.revoked = g._count._all;
    }
    return out;
  }

  private toDto(dp: any, stats: { available: number; assigned: number; revoked: number }): DigitalProductDto {
    return {
      id: dp.id,
      productId: dp.productId,
      type: dp.type as DigitalGoodType,
      fileObjectKey: dp.fileObjectKey ?? null,
      fileSizeBytes: dp.fileSizeBytes ?? null,
      downloadLimit: dp.downloadLimit,
      expiryDays: dp.expiryDays,
      notesToBuyer: dp.notesToBuyer ?? null,
      poolStats: stats,
    };
  }
}

function guessContentType(name: string): string {
  const lower = name.toLowerCase();
  if (lower.endsWith('.zip')) return 'application/zip';
  if (lower.endsWith('.pdf')) return 'application/pdf';
  if (lower.endsWith('.mp3')) return 'audio/mpeg';
  if (lower.endsWith('.mp4')) return 'video/mp4';
  if (lower.endsWith('.epub')) return 'application/epub+zip';
  return 'application/octet-stream';
}
