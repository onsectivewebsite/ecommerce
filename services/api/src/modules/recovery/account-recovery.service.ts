import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { createHash, randomBytes } from 'crypto';
import type { AccountRecoveryRequest } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { EmailService } from '../email/email.service';
import { newId } from '../../common/id';

/** 72-hour mandatory waiting window between confirmation and completion. */
export const RECOVERY_WAIT_HOURS = 72;
/** A PENDING request the user never confirms is dropped after this long. */
const PENDING_TTL_HOURS = 24;
/** A CONFIRMED request left uncompleted this long past eligibility is dropped. */
const STALE_DAYS_PAST_ELIGIBLE = 7;

export interface RequestMeta {
  ip?: string | null;
  userAgent?: string | null;
}

interface TokenTriple {
  confirm: string;
  cancel: string;
  complete: string;
}

/**
 * Phase 34 — 2FA lockout recovery.
 *
 * A user who can prove control of the account email but has lost every second
 * factor can remove 2FA — but only after a 72h waiting window during which the
 * real owner is repeatedly emailed and can cancel with one click. This is the
 * Apple-style "account recovery delay" pattern: email control alone never
 * grants instant takeover.
 */
@Injectable()
export class AccountRecoveryService {
  private readonly logger = new Logger(AccountRecoveryService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly email: EmailService,
    private readonly events: EventEmitter2,
    private readonly cfg: ConfigService,
  ) {}

  private get webUrl(): string {
    return (
      this.cfg.get<string>('BUYER_WEB_URL') ??
      this.cfg.get<string>('PUBLIC_WEB_URL') ??
      'http://localhost:3000'
    );
  }

  private hash(raw: string): string {
    return createHash('sha256').update(raw).digest('hex');
  }

  private mintTokens(): { raw: TokenTriple; hashed: TokenTriple } {
    const raw: TokenTriple = {
      confirm: randomBytes(24).toString('base64url'),
      cancel: randomBytes(24).toString('base64url'),
      complete: randomBytes(24).toString('base64url'),
    };
    return {
      raw,
      hashed: {
        confirm: this.hash(raw.confirm),
        cancel: this.hash(raw.cancel),
        complete: this.hash(raw.complete),
      },
    };
  }

  private confirmUrl(t: string) {
    return `${this.webUrl}/account-recovery/confirm?token=${encodeURIComponent(t)}`;
  }
  private cancelUrl(t: string) {
    return `${this.webUrl}/account-recovery/cancel?token=${encodeURIComponent(t)}`;
  }
  private completeUrl(t: string) {
    return `${this.webUrl}/account-recovery/complete?token=${encodeURIComponent(t)}`;
  }

  /**
   * Start a recovery. Enumeration-safe: always resolves. Sends email only if
   * the account exists AND actually has 2FA (otherwise recovery is moot —
   * the user should just reset their password).
   */
  async start(email: string, meta: RequestMeta): Promise<void> {
    const user = await this.prisma.user.findUnique({
      where: { email: email.toLowerCase() },
      include: { webauthnCredentials: { select: { id: true } } },
    });
    if (!user || user.deletionStatus === 'COMPLETED' || user.passwordHash === '') {
      return;
    }
    const hasTotp = user.twoFactorEnabled;
    const hasPasskeys = user.webauthnCredentials.length > 0;
    if (!hasTotp && !hasPasskeys) {
      // Nothing to recover from — silently no-op (no enumeration leak).
      return;
    }

    // Supersede any earlier in-flight request for this user.
    await this.prisma.accountRecoveryRequest.updateMany({
      where: { userId: user.id, status: { in: ['PENDING', 'CONFIRMED'] } },
      data: { status: 'CANCELLED', cancelledAt: new Date() },
    });

    const { raw, hashed } = this.mintTokens();
    await this.prisma.accountRecoveryRequest.create({
      data: {
        id: newId(),
        userId: user.id,
        status: 'PENDING',
        confirmTokenHash: hashed.confirm,
        cancelTokenHash: hashed.cancel,
        completeTokenHash: hashed.complete,
        ip: meta.ip ?? null,
        userAgent: meta.userAgent ?? null,
      },
    });

    await this.email
      .sendToUser(user.id, 'account_recovery_requested', {
        firstName: user.firstName,
        waitHours: RECOVERY_WAIT_HOURS,
        confirmUrl: this.confirmUrl(raw.confirm),
        cancelUrl: this.cancelUrl(raw.cancel),
      })
      .catch((e) => this.logger.warn(`recovery_requested email failed: ${e}`));

    await this.audit
      .record({
        actorUserId: user.id,
        action: 'auth.recovery.started',
        entityType: 'User',
        entityId: user.id,
        ip: meta.ip,
        userAgent: meta.userAgent,
      })
      .catch(() => undefined);
  }

  /** PENDING → CONFIRMED, starts the 72h timer. */
  async confirm(token: string): Promise<{ ok: true; eligibleAt: string }> {
    const req = await this.prisma.accountRecoveryRequest.findUnique({
      where: { confirmTokenHash: this.hash(token) },
    });
    if (!req) throw new NotFoundException('Recovery link not recognized');
    if (req.status === 'CONFIRMED' && req.eligibleAt) {
      // Idempotent — clicking confirm twice just returns the same eligibleAt.
      return { ok: true, eligibleAt: req.eligibleAt.toISOString() };
    }
    if (req.status !== 'PENDING') {
      throw new BadRequestException(`Recovery is ${req.status.toLowerCase()}`);
    }
    const now = new Date();
    const eligibleAt = new Date(now.getTime() + RECOVERY_WAIT_HOURS * 3600 * 1000);
    await this.prisma.accountRecoveryRequest.update({
      where: { id: req.id },
      data: { status: 'CONFIRMED', confirmedAt: now, eligibleAt },
    });

    const cancelToken = await this.rawCancelToken(req);
    await this.email
      .sendToUser(req.userId, 'account_recovery_confirmed', {
        firstName: await this.firstName(req.userId),
        eligibleAt: eligibleAt.toUTCString(),
        cancelUrl: cancelToken ? this.cancelUrl(cancelToken) : `${this.webUrl}/account-recovery`,
      })
      .catch((e) => this.logger.warn(`recovery_confirmed email failed: ${e}`));

    await this.audit
      .record({
        actorUserId: req.userId,
        action: 'auth.recovery.confirmed',
        entityType: 'AccountRecoveryRequest',
        entityId: req.id,
      })
      .catch(() => undefined);

    return { ok: true, eligibleAt: eligibleAt.toISOString() };
  }

  /** Any non-terminal status → CANCELLED. Honored until completion. */
  async cancel(token: string, byAdmin = false): Promise<{ ok: true }> {
    const req = await this.prisma.accountRecoveryRequest.findUnique({
      where: { cancelTokenHash: this.hash(token) },
    });
    if (!req) throw new NotFoundException('Cancel link not recognized');
    if (['COMPLETED', 'CANCELLED', 'EXPIRED'].includes(req.status)) {
      return { ok: true }; // idempotent — already terminal
    }
    await this.cancelById(req.id, req.userId, byAdmin);
    return { ok: true };
  }

  /** Used by the admin controller, which works by request id not token. */
  async cancelById(id: string, userId: string, byAdmin: boolean) {
    await this.prisma.accountRecoveryRequest.update({
      where: { id },
      data: { status: 'CANCELLED', cancelledAt: new Date() },
    });
    await this.email
      .sendToUser(userId, 'account_recovery_cancelled', {
        firstName: await this.firstName(userId),
      })
      .catch((e) => this.logger.warn(`recovery_cancelled email failed: ${e}`));
    await this.audit
      .record({
        actorUserId: userId,
        action: byAdmin ? 'auth.recovery.cancelled_by_admin' : 'auth.recovery.cancelled',
        entityType: 'AccountRecoveryRequest',
        entityId: id,
      })
      .catch(() => undefined);
  }

  /** Public status read for the frontend countdown. Accepts confirm OR complete token. */
  async status(token: string) {
    const hash = this.hash(token);
    const req = await this.prisma.accountRecoveryRequest.findFirst({
      where: {
        OR: [{ confirmTokenHash: hash }, { completeTokenHash: hash }],
      },
    });
    if (!req) throw new NotFoundException('Recovery link not recognized');
    const now = Date.now();
    return {
      status: req.status,
      confirmedAt: req.confirmedAt?.toISOString() ?? null,
      eligibleAt: req.eligibleAt?.toISOString() ?? null,
      eligibleNow:
        req.status === 'CONFIRMED' &&
        !!req.eligibleAt &&
        req.eligibleAt.getTime() <= now,
    };
  }

  /**
   * Complete recovery — strip 2FA. Requires CONFIRMED + past eligibleAt.
   * Accepts the dedicated complete token OR the confirm token: both were
   * delivered to the same inbox, so the confirm token completing once the
   * window elapsed adds no attack surface and lets the countdown page
   * finish the flow without a second trip to email.
   */
  async complete(token: string, meta: RequestMeta): Promise<{ ok: true }> {
    const hash = this.hash(token);
    const req = await this.prisma.accountRecoveryRequest.findFirst({
      where: {
        OR: [{ completeTokenHash: hash }, { confirmTokenHash: hash }],
      },
    });
    if (!req) throw new NotFoundException('Recovery link not recognized');
    if (req.status === 'COMPLETED') return { ok: true };
    if (req.status !== 'CONFIRMED') {
      throw new BadRequestException(`Recovery is ${req.status.toLowerCase()}`);
    }
    if (!req.eligibleAt || req.eligibleAt.getTime() > Date.now()) {
      throw new UnauthorizedException('Recovery waiting period has not elapsed');
    }

    // Strip every second factor + force re-login everywhere.
    await this.prisma.$transaction([
      this.prisma.recoveryCode.deleteMany({ where: { userId: req.userId } }),
      this.prisma.totpEnrollment.deleteMany({ where: { userId: req.userId } }),
      this.prisma.webAuthnCredential.deleteMany({ where: { userId: req.userId } }),
      this.prisma.user.update({
        where: { id: req.userId },
        data: { twoFactorEnabled: false },
      }),
      this.prisma.refreshToken.updateMany({
        where: { userId: req.userId, revokedAt: null },
        data: { revokedAt: new Date() },
      }),
      this.prisma.accountRecoveryRequest.update({
        where: { id: req.id },
        data: { status: 'COMPLETED', completedAt: new Date() },
      }),
    ]);

    await this.email
      .sendToUser(req.userId, 'account_recovery_completed', {
        firstName: await this.firstName(req.userId),
      })
      .catch((e) => this.logger.warn(`recovery_completed email failed: ${e}`));

    await this.audit
      .record({
        actorUserId: req.userId,
        action: 'auth.recovery.completed',
        entityType: 'AccountRecoveryRequest',
        entityId: req.id,
        ip: meta.ip,
        userAgent: meta.userAgent,
      })
      .catch(() => undefined);
    this.events.emit('auth.recovery.completed', { userId: req.userId });

    return { ok: true };
  }

  // ───────────────────────── Admin ─────────────────────────

  async listActive() {
    const rows = await this.prisma.accountRecoveryRequest.findMany({
      where: { status: { in: ['PENDING', 'CONFIRMED'] } },
      orderBy: { requestedAt: 'desc' },
      include: { user: { select: { email: true, firstName: true, lastName: true } } },
      take: 200,
    });
    return rows.map((r) => ({
      id: r.id,
      userId: r.userId,
      email: r.user.email,
      name: `${r.user.firstName} ${r.user.lastName}`.trim(),
      status: r.status,
      requestedAt: r.requestedAt.toISOString(),
      confirmedAt: r.confirmedAt?.toISOString() ?? null,
      eligibleAt: r.eligibleAt?.toISOString() ?? null,
      remindersSent: r.remindersSent,
    }));
  }

  // ───────────────────────── Scheduler hooks ─────────────────────────

  /**
   * Walk in-flight requests:
   *  - PENDING older than 24h → EXPIRED
   *  - CONFIRMED → send reminders at ~24h and ~48h, "ready" once eligible
   *  - CONFIRMED stale 7d past eligibility → EXPIRED
   */
  async scan(): Promise<{ expired: number; reminded: number }> {
    const now = Date.now();
    let expired = 0;
    let reminded = 0;

    const pendingStale = await this.prisma.accountRecoveryRequest.findMany({
      where: {
        status: 'PENDING',
        requestedAt: { lt: new Date(now - PENDING_TTL_HOURS * 3600 * 1000) },
      },
    });
    for (const r of pendingStale) {
      await this.prisma.accountRecoveryRequest.update({
        where: { id: r.id },
        data: { status: 'EXPIRED' },
      });
      expired++;
    }

    const confirmed = await this.prisma.accountRecoveryRequest.findMany({
      where: { status: 'CONFIRMED' },
    });
    for (const r of confirmed) {
      if (!r.confirmedAt || !r.eligibleAt) continue;
      const sinceConfirm = now - r.confirmedAt.getTime();
      const pastEligible = now - r.eligibleAt.getTime();

      if (pastEligible > STALE_DAYS_PAST_ELIGIBLE * 86400 * 1000) {
        await this.prisma.accountRecoveryRequest.update({
          where: { id: r.id },
          data: { status: 'EXPIRED' },
        });
        expired++;
        continue;
      }

      // Reminder cadence: 1st at ~24h, 2nd at ~48h, "ready" once eligible.
      const due24 = sinceConfirm >= 24 * 3600 * 1000 && r.remindersSent < 1;
      const due48 = sinceConfirm >= 48 * 3600 * 1000 && r.remindersSent < 2;
      const ready = now >= r.eligibleAt.getTime() && r.remindersSent < 3;

      if (ready) {
        await this.sendReady(r);
        await this.prisma.accountRecoveryRequest.update({
          where: { id: r.id },
          data: { remindersSent: 3 },
        });
        reminded++;
      } else if (due48) {
        await this.sendReminder(r);
        await this.prisma.accountRecoveryRequest.update({
          where: { id: r.id },
          data: { remindersSent: 2 },
        });
        reminded++;
      } else if (due24) {
        await this.sendReminder(r);
        await this.prisma.accountRecoveryRequest.update({
          where: { id: r.id },
          data: { remindersSent: 1 },
        });
        reminded++;
      }
    }
    return { expired, reminded };
  }

  private async sendReminder(r: AccountRecoveryRequest) {
    const cancel = await this.rawCancelToken(r);
    await this.email
      .sendToUser(r.userId, 'account_recovery_reminder', {
        firstName: await this.firstName(r.userId),
        eligibleAt: r.eligibleAt?.toUTCString() ?? '',
        cancelUrl: cancel ? this.cancelUrl(cancel) : `${this.webUrl}/account-recovery`,
      })
      .catch((e) => this.logger.warn(`recovery_reminder email failed: ${e}`));
  }

  private async sendReady(r: AccountRecoveryRequest) {
    const cancel = await this.rawCancelToken(r);
    const complete = await this.rawCompleteToken(r);
    await this.email
      .sendToUser(r.userId, 'account_recovery_ready', {
        firstName: await this.firstName(r.userId),
        completeUrl: complete ? this.completeUrl(complete) : `${this.webUrl}/account-recovery`,
        cancelUrl: cancel ? this.cancelUrl(cancel) : `${this.webUrl}/account-recovery`,
      })
      .catch((e) => this.logger.warn(`recovery_ready email failed: ${e}`));
  }

  // ───────────────────────── helpers ─────────────────────────

  private async firstName(userId: string): Promise<string> {
    const u = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { firstName: true },
    });
    return u?.firstName ?? 'there';
  }

  /**
   * We store only token *hashes*, so reminder/confirmation emails sent AFTER
   * the initial /start can't reconstruct the raw cancel/complete tokens.
   * To keep the cancel link working in every email we re-mint the raw tokens
   * by rotating them: each time we need to email a link we generate a fresh
   * raw token, store its hash, and embed the fresh one. The previous link
   * stops working — acceptable, since only the newest email matters.
   */
  private async rawCancelToken(r: AccountRecoveryRequest): Promise<string | null> {
    const raw = randomBytes(24).toString('base64url');
    try {
      await this.prisma.accountRecoveryRequest.update({
        where: { id: r.id },
        data: { cancelTokenHash: this.hash(raw) },
      });
      return raw;
    } catch (e) {
      this.logger.warn(`cancel token rotate failed: ${e}`);
      return null;
    }
  }

  private async rawCompleteToken(r: AccountRecoveryRequest): Promise<string | null> {
    const raw = randomBytes(24).toString('base64url');
    try {
      await this.prisma.accountRecoveryRequest.update({
        where: { id: r.id },
        data: { completeTokenHash: this.hash(raw) },
      });
      return raw;
    } catch (e) {
      this.logger.warn(`complete token rotate failed: ${e}`);
      return null;
    }
  }
}
