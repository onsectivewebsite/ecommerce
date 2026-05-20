import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as argon2 from 'argon2';
import { createHash, randomBytes } from 'crypto';
import { TwoFactorChallengeKind } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { newId } from '../../common/id';
import {
  buildOtpauthUrl,
  generateSecret,
  toBase32,
  verifyTotp,
} from './totp';
import { decryptSecret, encryptSecret } from './secret-crypto';
import {
  generateRecoveryCode,
  normalizeRecoveryCode,
} from './recovery-codes';

const RECOVERY_CODE_COUNT = 10;
const LOGIN_CHALLENGE_TTL_MS = 5 * 60 * 1000;
const DISABLE_CHALLENGE_TTL_MS = 5 * 60 * 1000;

export interface ActorMeta {
  actorUserId?: string | null;
  ip?: string | null;
  userAgent?: string | null;
}

export interface VerifySuccess {
  userId: string;
  usedRecoveryCode: boolean;
}

@Injectable()
export class TwoFactorService {
  private readonly logger = new Logger(TwoFactorService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly cfg: ConfigService,
  ) {}

  private get issuer(): string {
    return this.cfg.get<string>('TWO_FACTOR_ISSUER') ?? 'Onsective';
  }

  private hashToken(raw: string): string {
    return createHash('sha256').update(raw).digest('hex');
  }

  /**
   * Begin (or restart) enrollment. Creates a PENDING TotpEnrollment with a
   * fresh secret. If a PENDING row exists, the secret is rotated. If an
   * ACTIVE row exists we refuse — caller must disable first.
   */
  async enrollStart(userId: string, meta: ActorMeta) {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user) throw new NotFoundException('User not found');

    const existing = await this.prisma.totpEnrollment.findUnique({
      where: { userId },
    });
    if (existing && existing.status === 'ACTIVE') {
      throw new BadRequestException(
        'Two-factor is already active. Disable it before enrolling again.',
      );
    }

    const secret = generateSecret();
    const enc = encryptSecret(secret);
    const now = new Date();

    if (existing) {
      await this.prisma.totpEnrollment.update({
        where: { userId },
        data: {
          secretCipher: enc.cipher,
          secretIv: enc.iv,
          secretTag: enc.tag,
          status: 'PENDING',
          lastUsedStep: BigInt(0),
          activatedAt: null,
          lastUsedAt: null,
          updatedAt: now,
        },
      });
    } else {
      await this.prisma.totpEnrollment.create({
        data: {
          id: newId(),
          userId,
          secretCipher: enc.cipher,
          secretIv: enc.iv,
          secretTag: enc.tag,
          status: 'PENDING',
        },
      });
    }

    await this.audit
      .record({
        actorUserId: meta.actorUserId ?? userId,
        action: 'two_factor.enroll.start',
        entityType: 'User',
        entityId: userId,
        ip: meta.ip,
        userAgent: meta.userAgent,
      })
      .catch((e) => this.logger.warn(`audit enroll.start failed: ${e}`));

    return {
      otpauthUrl: buildOtpauthUrl({
        issuer: this.issuer,
        accountName: user.email,
        secret,
      }),
      secretBase32: toBase32(secret),
    };
  }

  /**
   * Verify the TOTP from the user's authenticator and activate enrollment.
   * Issues fresh recovery codes and returns them in cleartext (one-shot).
   */
  async enrollVerify(
    userId: string,
    code: string,
    meta: ActorMeta,
  ): Promise<{ recoveryCodes: string[] }> {
    const enrollment = await this.prisma.totpEnrollment.findUnique({
      where: { userId },
    });
    if (!enrollment || enrollment.status !== 'PENDING') {
      throw new BadRequestException('No pending enrollment to verify');
    }
    const secret = decryptSecret({
      cipher: enrollment.secretCipher,
      iv: enrollment.secretIv,
      tag: enrollment.secretTag,
    });
    const step = verifyTotp(secret, code, {
      lastUsedStep: Number(enrollment.lastUsedStep),
    });
    if (step === null) throw new UnauthorizedException('Invalid code');

    const codes = await this.regenerateRecoveryCodesInner(userId);

    await this.prisma.$transaction([
      this.prisma.totpEnrollment.update({
        where: { userId },
        data: {
          status: 'ACTIVE',
          activatedAt: new Date(),
          lastUsedStep: BigInt(step),
          lastUsedAt: new Date(),
        },
      }),
      this.prisma.user.update({
        where: { id: userId },
        data: { twoFactorEnabled: true },
      }),
    ]);

    await this.audit
      .record({
        actorUserId: meta.actorUserId ?? userId,
        action: 'two_factor.enroll.activated',
        entityType: 'User',
        entityId: userId,
        ip: meta.ip,
        userAgent: meta.userAgent,
      })
      .catch((e) => this.logger.warn(`audit enroll.activated failed: ${e}`));

    return { recoveryCodes: codes };
  }

  /**
   * Create a short-lived challenge token after a password check has passed
   * but before tokens are issued. The opaque token is returned to the client
   * and presented to /auth/2fa/verify.
   */
  async createLoginChallenge(userId: string): Promise<string> {
    return this.createChallenge(userId, 'LOGIN', LOGIN_CHALLENGE_TTL_MS);
  }

  /**
   * Phase 33: consume a LOGIN-kind challenge when the second factor was
   * satisfied by some other mechanism (today: WebAuthn assertion). The
   * caller is responsible for proving that other mechanism first;
   * we only verify the challenge token belongs to the right user.
   */
  async consumeLoginChallengeForUser(rawToken: string, expectedUserId: string) {
    const row = await this.prisma.twoFactorChallenge.findUnique({
      where: { tokenHash: createHash('sha256').update(rawToken).digest('hex') },
    });
    if (!row) throw new UnauthorizedException('Challenge not found');
    if (row.consumedAt) throw new UnauthorizedException('Challenge already used');
    if (row.expiresAt < new Date()) {
      throw new UnauthorizedException('Challenge expired');
    }
    if (row.kind !== 'LOGIN') {
      throw new UnauthorizedException('Challenge kind mismatch');
    }
    if (row.userId !== expectedUserId) {
      throw new UnauthorizedException('Challenge user mismatch');
    }
    await this.prisma.twoFactorChallenge.update({
      where: { id: row.id },
      data: { consumedAt: new Date() },
    });
    return row;
  }

  async createDisableChallenge(userId: string): Promise<string> {
    return this.createChallenge(userId, 'DISABLE', DISABLE_CHALLENGE_TTL_MS);
  }

  private async createChallenge(
    userId: string,
    kind: TwoFactorChallengeKind,
    ttlMs: number,
  ): Promise<string> {
    const raw = randomBytes(32).toString('hex');
    await this.prisma.twoFactorChallenge.create({
      data: {
        id: newId(),
        userId,
        kind,
        tokenHash: this.hashToken(raw),
        expiresAt: new Date(Date.now() + ttlMs),
      },
    });
    return raw;
  }

  /**
   * Consume a challenge by verifying either a TOTP or a recovery code.
   * Returns the userId on success.
   */
  async verifyChallenge(
    challenge: string,
    code: string,
    expectKind: TwoFactorChallengeKind,
    meta: ActorMeta,
  ): Promise<VerifySuccess> {
    const row = await this.prisma.twoFactorChallenge.findUnique({
      where: { tokenHash: this.hashToken(challenge) },
    });
    if (!row) throw new UnauthorizedException('Challenge not found');
    if (row.consumedAt) throw new UnauthorizedException('Challenge already used');
    if (row.expiresAt < new Date()) {
      throw new UnauthorizedException('Challenge expired');
    }
    if (row.kind !== expectKind) {
      throw new UnauthorizedException('Challenge kind mismatch');
    }

    const enrollment = await this.prisma.totpEnrollment.findUnique({
      where: { userId: row.userId },
    });

    let usedRecoveryCode = false;
    if (enrollment && enrollment.status === 'ACTIVE') {
      const secret = decryptSecret({
        cipher: enrollment.secretCipher,
        iv: enrollment.secretIv,
        tag: enrollment.secretTag,
      });
      const step = verifyTotp(secret, code, {
        lastUsedStep: Number(enrollment.lastUsedStep),
      });
      if (step !== null) {
        await this.prisma.totpEnrollment.update({
          where: { userId: row.userId },
          data: {
            lastUsedStep: BigInt(step),
            lastUsedAt: new Date(),
          },
        });
      } else {
        usedRecoveryCode = await this.consumeRecoveryCode(row.userId, code);
        if (!usedRecoveryCode) throw new UnauthorizedException('Invalid code');
      }
    } else {
      // ACTIVE enrollment missing — only path left is recovery, but with no
      // active enrollment recovery codes are meaningless. Reject.
      throw new UnauthorizedException('Two-factor not enabled');
    }

    await this.prisma.twoFactorChallenge.update({
      where: { id: row.id },
      data: { consumedAt: new Date() },
    });

    await this.audit
      .record({
        actorUserId: row.userId,
        action: usedRecoveryCode
          ? 'two_factor.verify.recovery_code'
          : `two_factor.verify.${expectKind.toLowerCase()}`,
        entityType: 'User',
        entityId: row.userId,
        ip: meta.ip,
        userAgent: meta.userAgent,
      })
      .catch((e) => this.logger.warn(`audit verify failed: ${e}`));

    return { userId: row.userId, usedRecoveryCode };
  }

  private async consumeRecoveryCode(
    userId: string,
    submitted: string,
  ): Promise<boolean> {
    const normalized = normalizeRecoveryCode(submitted);
    if (normalized.length !== 8) return false;
    const candidates = await this.prisma.recoveryCode.findMany({
      where: { userId, usedAt: null },
    });
    for (const row of candidates) {
      try {
        const ok = await argon2.verify(row.codeHash, normalized);
        if (ok) {
          await this.prisma.recoveryCode.update({
            where: { id: row.id },
            data: { usedAt: new Date() },
          });
          return true;
        }
      } catch {
        // Treat verify errors as no-match; do not leak.
      }
    }
    return false;
  }

  /**
   * Disable 2FA. The caller must have just satisfied a DISABLE challenge
   * (verifyChallenge with kind=DISABLE), which proves they hold a current
   * OTP or recovery code. We also revoke all refresh tokens to force
   * re-authentication everywhere.
   */
  async disable(userId: string, meta: ActorMeta) {
    await this.prisma.$transaction([
      this.prisma.recoveryCode.deleteMany({ where: { userId } }),
      this.prisma.totpEnrollment.deleteMany({ where: { userId } }),
      this.prisma.user.update({
        where: { id: userId },
        data: { twoFactorEnabled: false },
      }),
      this.prisma.refreshToken.updateMany({
        where: { userId, revokedAt: null },
        data: { revokedAt: new Date() },
      }),
    ]);

    await this.audit
      .record({
        actorUserId: meta.actorUserId ?? userId,
        action: 'two_factor.disabled',
        entityType: 'User',
        entityId: userId,
        ip: meta.ip,
        userAgent: meta.userAgent,
      })
      .catch((e) => this.logger.warn(`audit disable failed: ${e}`));

    return { ok: true as const };
  }

  /**
   * Issue a fresh set of recovery codes, invalidating any prior set. Caller
   * must have just satisfied a DISABLE challenge.
   */
  async regenerateRecoveryCodes(userId: string, meta: ActorMeta) {
    const enrollment = await this.prisma.totpEnrollment.findUnique({
      where: { userId },
    });
    if (!enrollment || enrollment.status !== 'ACTIVE') {
      throw new BadRequestException('Two-factor not enabled');
    }
    const codes = await this.regenerateRecoveryCodesInner(userId);
    await this.audit
      .record({
        actorUserId: meta.actorUserId ?? userId,
        action: 'two_factor.recovery_codes.regenerated',
        entityType: 'User',
        entityId: userId,
        ip: meta.ip,
        userAgent: meta.userAgent,
      })
      .catch((e) => this.logger.warn(`audit recovery regen failed: ${e}`));
    return { recoveryCodes: codes };
  }

  private async regenerateRecoveryCodesInner(userId: string): Promise<string[]> {
    const cleartext: string[] = [];
    const hashed: { id: string; userId: string; codeHash: string }[] = [];
    for (let i = 0; i < RECOVERY_CODE_COUNT; i++) {
      const code = generateRecoveryCode();
      cleartext.push(code);
      // argon2 the normalized form (no dashes) so verify matches regardless of
      // how the user re-types it.
      const normalized = normalizeRecoveryCode(code);
      const hash = await argon2.hash(normalized);
      hashed.push({ id: newId(), userId, codeHash: hash });
    }
    await this.prisma.$transaction([
      this.prisma.recoveryCode.deleteMany({ where: { userId } }),
      this.prisma.recoveryCode.createMany({ data: hashed }),
    ]);
    return cleartext;
  }

  /** Admin reset — no challenge required; the admin's role guard already gates this. */
  async adminReset(targetUserId: string, actor: ActorMeta) {
    const enrollment = await this.prisma.totpEnrollment.findUnique({
      where: { userId: targetUserId },
    });
    if (!enrollment) {
      // Idempotent — already off.
      await this.prisma.user.update({
        where: { id: targetUserId },
        data: { twoFactorEnabled: false },
      });
      return { ok: true as const };
    }
    await this.prisma.$transaction([
      this.prisma.recoveryCode.deleteMany({ where: { userId: targetUserId } }),
      this.prisma.totpEnrollment.deleteMany({ where: { userId: targetUserId } }),
      this.prisma.user.update({
        where: { id: targetUserId },
        data: { twoFactorEnabled: false },
      }),
      this.prisma.refreshToken.updateMany({
        where: { userId: targetUserId, revokedAt: null },
        data: { revokedAt: new Date() },
      }),
    ]);
    await this.audit
      .record({
        actorUserId: actor.actorUserId,
        action: 'two_factor.admin_reset',
        entityType: 'User',
        entityId: targetUserId,
        ip: actor.ip,
        userAgent: actor.userAgent,
      })
      .catch((e) => this.logger.warn(`audit admin_reset failed: ${e}`));
    return { ok: true as const };
  }

  async status(userId: string) {
    const [user, enrollment, recovery] = await Promise.all([
      this.prisma.user.findUnique({
        where: { id: userId },
        select: { twoFactorEnabled: true },
      }),
      this.prisma.totpEnrollment.findUnique({ where: { userId } }),
      this.prisma.recoveryCode.count({ where: { userId, usedAt: null } }),
    ]);
    return {
      enabled: user?.twoFactorEnabled ?? false,
      enrollmentStatus: enrollment?.status ?? null,
      activatedAt: enrollment?.activatedAt?.toISOString() ?? null,
      lastUsedAt: enrollment?.lastUsedAt?.toISOString() ?? null,
      recoveryCodesRemaining: recovery,
    };
  }
}
