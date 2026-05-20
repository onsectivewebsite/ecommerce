import { BadRequestException, ForbiddenException, Injectable, Logger } from '@nestjs/common';
import { createHash, randomBytes, randomInt } from 'crypto';
import { PrismaService } from '../../prisma/prisma.service';
import { newId } from '../../common/id';
import { EmailService } from '../email/email.service';
import type { LoginOutcome } from '@prisma/client';

const IMPOSSIBLE_TRAVEL_MIN_HOURS = 2;
const STEP_UP_TTL_MIN = 10;

/**
 * Security primitives: login event capture, device + travel anomaly
 * detection, one-time email-token step-up for sensitive actions.
 */
@Injectable()
export class SecurityService {
  private readonly logger = new Logger(SecurityService.name);
  private readonly ipSalt: string;

  constructor(
    private readonly prisma: PrismaService,
    private readonly email: EmailService,
  ) {
    this.ipSalt = process.env.LOGIN_IP_SALT ?? 'onsective-dev-salt';
  }

  // ---------- login capture ----------

  /**
   * Persist a login (or refresh) event. Returns `{ newDevice, anomaly }` so
   * the caller can react (e.g., trigger an email warning, force step-up).
   */
  async recordLogin(input: {
    userId: string;
    outcome: LoginOutcome;
    ip?: string;
    userAgent?: string;
    country?: string;
  }) {
    const hashedIp = this.hashIp(input.ip ?? '');
    const uaFingerprint = this.fingerprintUa(input.userAgent ?? '');
    let newDevice = false;
    let anomaly: string | null = null;

    if (input.outcome === 'SUCCESS') {
      // New device — any prior success with this fingerprint?
      const prior = await this.prisma.loginEvent.findFirst({
        where: { userId: input.userId, outcome: 'SUCCESS', uaFingerprint },
        select: { id: true },
      });
      newDevice = !prior;
      // Impossible travel — prior event from a different country within window.
      if (input.country) {
        const recent = await this.prisma.loginEvent.findFirst({
          where: {
            userId: input.userId, outcome: 'SUCCESS',
            occurredAt: { gte: new Date(Date.now() - IMPOSSIBLE_TRAVEL_MIN_HOURS * 60 * 60 * 1000) },
            country: { not: null },
          },
          orderBy: { occurredAt: 'desc' },
        });
        if (recent && recent.country && recent.country !== input.country) {
          anomaly = `Country change ${recent.country} → ${input.country} within ${IMPOSSIBLE_TRAVEL_MIN_HOURS}h`;
        }
      }
    }

    await this.prisma.loginEvent.create({
      data: {
        id: newId(),
        userId: input.userId,
        outcome: input.outcome,
        hashedIp,
        uaFingerprint,
        country: input.country ?? null,
        newDevice,
        anomaly,
      },
    });

    if (input.outcome === 'SUCCESS' && (newDevice || anomaly)) {
      // Fire an informational email; non-blocking.
      const reason = anomaly ? anomaly : 'Sign-in from a new device';
      this.email.sendToUser(input.userId, 'security_sign_in_alert', {
        reason,
        country: input.country ?? 'unknown',
      }).catch(() => undefined);
    }

    return { newDevice, anomaly };
  }

  async listLoginEvents(userId: string, limit = 50) {
    return this.prisma.loginEvent.findMany({
      where: { userId },
      orderBy: { occurredAt: 'desc' },
      take: limit,
      select: {
        id: true, outcome: true, country: true, newDevice: true, anomaly: true,
        occurredAt: true, uaFingerprint: true,
      },
    });
  }

  // ---------- step-up challenge ----------

  /** Issue a 6-digit code, email it. Token is hashed in DB; the caller stores
   *  the raw `challengeId` and the user supplies the code separately. */
  async issueStepUp(userId: string, purpose: string): Promise<{ challengeId: string }> {
    const code = String(randomInt(100_000, 999_999));
    const challengeId = newId();
    const tokenHash = this.hashToken(challengeId, code);
    await this.prisma.stepUpChallenge.create({
      data: {
        id: challengeId,
        userId,
        purpose,
        tokenHash,
        expiresAt: new Date(Date.now() + STEP_UP_TTL_MIN * 60_000),
        status: 'PENDING',
      },
    });
    // Email it
    await this.email.sendToUser(userId, 'security_step_up_code', { code }).catch((e) =>
      this.logger.warn(`step-up email failed: ${(e as Error).message}`),
    );
    return { challengeId };
  }

  /** Verify and consume a step-up challenge. Throws on bad code/expired. */
  async verifyStepUp(challengeId: string, code: string, purpose: string): Promise<void> {
    const ch = await this.prisma.stepUpChallenge.findUnique({ where: { id: challengeId } });
    if (!ch) throw new ForbiddenException('Challenge not found');
    if (ch.purpose !== purpose) throw new ForbiddenException('Challenge purpose mismatch');
    if (ch.status !== 'PENDING') throw new ForbiddenException('Challenge already used');
    if (ch.expiresAt < new Date()) {
      await this.prisma.stepUpChallenge.update({
        where: { id: ch.id }, data: { status: 'EXPIRED' },
      });
      throw new ForbiddenException('Challenge expired');
    }
    const expected = this.hashToken(challengeId, code);
    if (expected !== ch.tokenHash) throw new ForbiddenException('Bad code');
    await this.prisma.stepUpChallenge.update({
      where: { id: ch.id }, data: { status: 'CONSUMED', consumedAt: new Date() },
    });
  }

  /**
   * Convenience guard for service code: "this action needs step-up". Caller
   * supplies (userId, purpose, challengeId, code). Returns void on success;
   * throws if missing/invalid.
   */
  async requireStepUp(userId: string, purpose: string, challengeId?: string, code?: string) {
    if (!challengeId || !code) {
      const issued = await this.issueStepUp(userId, purpose);
      throw new BadRequestException({
        code: 'STEP_UP_REQUIRED',
        challengeId: issued.challengeId,
        message: 'A verification code was emailed to you. Resubmit with challengeId + code.',
      });
    }
    const ch = await this.prisma.stepUpChallenge.findUnique({ where: { id: challengeId } });
    if (!ch || ch.userId !== userId) throw new ForbiddenException('Challenge not yours');
    await this.verifyStepUp(challengeId, code, purpose);
  }

  // ---------- helpers ----------

  private hashIp(ip: string): string {
    return createHash('sha256').update(this.ipSalt + ':' + ip).digest('hex');
  }

  private fingerprintUa(ua: string): string {
    // Strip version-number noise so a minor browser update doesn't trigger
    // a new-device anomaly on every patch.
    const normalized = ua.toLowerCase().replace(/\d+(\.\d+)*/g, 'X');
    return createHash('sha256').update(normalized).digest('hex').slice(0, 32);
  }

  private hashToken(challengeId: string, code: string): string {
    // Include challengeId in the hash so codes can't be replayed across
    // different challenge rows.
    return createHash('sha256').update(`${challengeId}:${code}`).digest('hex');
  }
}
