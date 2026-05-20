import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { DataExportStatus } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { MediaService } from '../media/media.service';
import { newId } from '../../common/id';

const DAY_MS = 24 * 60 * 60 * 1000;

@Injectable()
export class DataExportService {
  private readonly logger = new Logger(DataExportService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly media: MediaService,
    private readonly cfg: ConfigService,
  ) {}

  private ttlDays(): number {
    return Number(this.cfg.get<string>('DATA_EXPORT_TTL_DAYS') ?? '7');
  }

  /**
   * Idempotent: if the buyer has a PENDING or BUILDING request in flight,
   * return that one instead of creating a duplicate.
   */
  async request(userId: string) {
    const inFlight = await this.prisma.dataExportRequest.findFirst({
      where: { userId, status: { in: [DataExportStatus.PENDING, DataExportStatus.BUILDING] } },
      orderBy: { createdAt: 'desc' },
    });
    if (inFlight) return inFlight;
    return this.prisma.dataExportRequest.create({
      data: {
        id: newId(),
        userId,
        status: DataExportStatus.PENDING,
      },
    });
  }

  /** Admin-facing list. Includes the user identity for the dashboard. */
  async adminRecent(params: { limit?: number; status?: DataExportStatus } = {}) {
    const rows = await this.prisma.dataExportRequest.findMany({
      where: params.status ? { status: params.status } : {},
      orderBy: { createdAt: 'desc' },
      take: Math.min(500, Math.max(1, params.limit ?? 100)),
      include: {
        user: { select: { id: true, email: true, firstName: true, lastName: true } },
      },
    });
    return rows.map((r) => ({
      id: r.id,
      status: r.status,
      sizeBytes: r.sizeBytes,
      createdAt: r.createdAt.toISOString(),
      completedAt: r.completedAt?.toISOString() ?? null,
      expiresAt: r.expiresAt?.toISOString() ?? null,
      error: r.error,
      user: {
        id: r.user.id,
        email: r.user.email,
        name: `${r.user.firstName} ${r.user.lastName}`.trim(),
      },
    }));
  }

  async listMine(userId: string) {
    const rows = await this.prisma.dataExportRequest.findMany({
      where: { userId },
      orderBy: { createdAt: 'desc' },
      take: 20,
    });
    // Lazy expiry: any READY row past its expiresAt is promoted to EXPIRED
    // on read so the UI doesn't expose dead URLs.
    const now = Date.now();
    return Promise.all(
      rows.map(async (r) => {
        if (r.status === DataExportStatus.READY && r.expiresAt && r.expiresAt.getTime() <= now) {
          return this.prisma.dataExportRequest.update({
            where: { id: r.id },
            data: { status: DataExportStatus.EXPIRED },
          });
        }
        return r;
      }),
    );
  }

  /**
   * Returns a fresh short-lived signed URL for a READY request. We don't
   * trust the downloadUrl column — we store the storage key there and
   * re-sign on every download so URLs never leak past one click.
   */
  async signedDownloadUrl(userId: string, requestId: string): Promise<string> {
    const row = await this.prisma.dataExportRequest.findUnique({ where: { id: requestId } });
    if (!row || row.userId !== userId) throw new NotFoundException('Export not found');
    if (row.status !== DataExportStatus.READY) {
      throw new BadRequestException(`Export is ${row.status.toLowerCase()}`);
    }
    if (row.expiresAt && row.expiresAt.getTime() <= Date.now()) {
      await this.prisma.dataExportRequest.update({
        where: { id: row.id },
        data: { status: DataExportStatus.EXPIRED },
      });
      throw new BadRequestException('Export expired');
    }
    if (!row.downloadUrl) throw new BadRequestException('Export has no storage key');
    return this.media.presignGetUrl(row.downloadUrl, 300); // 5-minute one-shot URL
  }

  // ---------------- builder ----------------

  /**
   * Picks up to `batch` PENDING rows and builds each into a JSON archive
   * stored via MediaService. Called by the scheduler. Sweeps expired
   * READY rows in the same tick.
   */
  async drainOnce(batch = 5): Promise<{ built: number; expired: number; failed: number }> {
    const pending = await this.prisma.dataExportRequest.findMany({
      where: { status: DataExportStatus.PENDING },
      orderBy: { createdAt: 'asc' },
      take: batch,
    });

    let built = 0;
    let failed = 0;
    for (const row of pending) {
      try {
        await this.processOne(row.id);
        built++;
      } catch (e) {
        failed++;
        this.logger.warn(`data export ${row.id} failed: ${(e as Error).message}`);
      }
    }
    const expired = await this.sweepExpired();
    return { built, expired, failed };
  }

  private async processOne(requestId: string) {
    await this.prisma.dataExportRequest.update({
      where: { id: requestId },
      data: { status: DataExportStatus.BUILDING },
    });
    let archive: Buffer;
    let row;
    try {
      row = await this.prisma.dataExportRequest.findUniqueOrThrow({ where: { id: requestId } });
      archive = Buffer.from(JSON.stringify(await this.buildArchive(row.userId), null, 2));
    } catch (e) {
      await this.prisma.dataExportRequest.update({
        where: { id: requestId },
        data: { status: DataExportStatus.FAILED, error: (e as Error).message },
      });
      throw e;
    }
    const key = `data-exports/${row.userId}/${requestId}.json`;
    await this.media.putObject(key, archive, 'application/json');
    await this.prisma.dataExportRequest.update({
      where: { id: requestId },
      data: {
        status: DataExportStatus.READY,
        downloadUrl: key, // storage key — controller signs on demand
        sizeBytes: archive.byteLength,
        expiresAt: new Date(Date.now() + this.ttlDays() * DAY_MS),
        completedAt: new Date(),
        error: null,
      },
    });
  }

  private async sweepExpired(): Promise<number> {
    const result = await this.prisma.dataExportRequest.updateMany({
      where: {
        status: DataExportStatus.READY,
        expiresAt: { lt: new Date() },
      },
      data: { status: DataExportStatus.EXPIRED },
    });
    return result.count;
  }

  /**
   * Gathers every personal data point we hold about this user into one
   * object. We include rows where the user is the actor (orders, returns,
   * messages) and where they're the subject of audit entries. We do NOT
   * include other users' PII (e.g., invitee names are first-name-only on
   * referrals) or raw payment provider tokens.
   */
  private async buildArchive(userId: string): Promise<Record<string, unknown>> {
    const [
      user,
      addresses,
      orders,
      returns,
      reviews,
      messages,
      wallet,
      walletTxns,
      points,
      pointsTxns,
      membership,
      paymentMethods,
      referralCode,
      referralsMade,
      pushDevices,
      preferences,
      notificationPref,
      auditLog,
    ] = await Promise.all([
      this.prisma.user.findUnique({
        where: { id: userId },
        select: {
          id: true, email: true, firstName: true, lastName: true,
          role: true, status: true, createdAt: true, updatedAt: true,
          signupIp: true, referralCodeUsed: true,
          deletionStatus: true, deletionRequestedAt: true,
          deletionScheduledFor: true, deletedAt: true,
        },
      }),
      this.prisma.address.findMany({ where: { userId } }),
      this.prisma.order.findMany({
        where: { userId },
        include: { items: true, shipment: true },
        orderBy: { createdAt: 'desc' },
      }),
      this.prisma.return.findMany({ where: { buyerUserId: userId }, include: { items: true } }),
      this.prisma.review.findMany({ where: { userId } }),
      this.prisma.message.findMany({ where: { senderUserId: userId } }),
      this.prisma.walletAccount.findUnique({ where: { userId } }),
      this.prisma.walletTransaction.findMany({
        where: { account: { userId } },
        orderBy: { createdAt: 'desc' },
      }),
      this.prisma.pointsAccount.findUnique({ where: { userId } }),
      this.prisma.pointsTransaction.findMany({
        where: { account: { userId } },
        orderBy: { createdAt: 'desc' },
      }),
      this.prisma.plusMembership.findUnique({
        where: { userId },
        include: { billingEvents: true },
      }),
      this.prisma.paymentMethod.findMany({
        where: { userId },
        select: {
          id: true, brand: true, last4: true, expMonth: true, expYear: true,
          isDefault: true, status: true, createdAt: true,
        },
      }),
      this.prisma.referralCode.findUnique({ where: { userId } }),
      this.prisma.referralRedemption.findMany({
        where: { inviterUserId: userId },
        select: {
          id: true, createdAt: true,
          inviterPointsAwarded: true, inviteePointsAwarded: true,
        },
      }),
      this.prisma.pushDevice.findMany({
        where: { userId },
        select: { id: true, platform: true, status: true, createdAt: true, lastSeenAt: true },
      }),
      this.prisma.userPreferences.findUnique({ where: { userId } }),
      this.prisma.notificationPreference.findUnique({ where: { userId } }),
      this.prisma.auditLogEntry.findMany({
        where: { actorUserId: userId },
        orderBy: { createdAt: 'desc' },
        take: 1000,
      }),
    ]);

    return {
      exportedAt: new Date().toISOString(),
      schemaVersion: 1,
      profile: user,
      addresses,
      orders,
      returns,
      reviews,
      messages,
      wallet: { account: wallet, transactions: walletTxns },
      points: { account: points, transactions: pointsTxns },
      membership,
      paymentMethods,
      referrals: { code: referralCode, redemptionsMade: referralsMade },
      pushDevices,
      preferences,
      notificationPreferences: notificationPref,
      auditLog,
    };
  }
}
