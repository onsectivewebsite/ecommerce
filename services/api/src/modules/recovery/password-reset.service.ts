import {
  BadRequestException,
  Injectable,
  Logger,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { EventEmitter2 } from '@nestjs/event-emitter';
import * as argon2 from 'argon2';
import { createHash, randomBytes } from 'crypto';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { EmailService } from '../email/email.service';
import { newId } from '../../common/id';

const RESET_TTL_HOURS = 1;
const MIN_PASSWORD_LEN = 8;

export interface RequestMeta {
  ip?: string | null;
  userAgent?: string | null;
}

/**
 * Phase 34 — standard email password reset.
 *
 * `forgot` is enumeration-safe: it always resolves without telling the caller
 * whether the email exists. `reset` consumes the token, sets the new password,
 * and revokes every refresh token so any hijacked session dies. It deliberately
 * does NOT touch 2FA — a 2FA-enabled account still needs the second factor.
 */
@Injectable()
export class PasswordResetService {
  private readonly logger = new Logger(PasswordResetService.name);

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

  /** Always resolves. Sends an email only if the account exists. */
  async forgot(email: string, meta: RequestMeta): Promise<void> {
    const user = await this.prisma.user.findUnique({
      where: { email: email.toLowerCase() },
    });
    // Enumeration-safe: silently succeed for unknown emails, and for
    // deleted/anonymized accounts (Phase 26 blanks the passwordHash).
    if (!user || user.passwordHash === '' || user.deletionStatus === 'COMPLETED') {
      return;
    }

    // Invalidate any earlier un-consumed tokens so a forwarded old email
    // can't be reused once a fresh one is issued.
    await this.prisma.passwordResetToken.deleteMany({
      where: { userId: user.id, consumedAt: null },
    });

    const raw = randomBytes(32).toString('base64url');
    await this.prisma.passwordResetToken.create({
      data: {
        id: newId(),
        userId: user.id,
        tokenHash: this.hash(raw),
        expiresAt: new Date(Date.now() + RESET_TTL_HOURS * 3600 * 1000),
        ip: meta.ip ?? null,
        userAgent: meta.userAgent ?? null,
      },
    });

    const resetUrl = `${this.webUrl}/reset-password?token=${encodeURIComponent(raw)}`;
    await this.email
      .sendToUser(user.id, 'password_reset', {
        firstName: user.firstName,
        resetUrl,
        ttlHours: RESET_TTL_HOURS,
      })
      .catch((e) => this.logger.warn(`password_reset email failed: ${e}`));

    await this.audit
      .record({
        actorUserId: user.id,
        action: 'auth.password.reset_requested',
        entityType: 'User',
        entityId: user.id,
        ip: meta.ip,
        userAgent: meta.userAgent,
      })
      .catch(() => undefined);
  }

  /** Consume the token, set the new password, revoke all sessions. */
  async reset(
    token: string,
    newPassword: string,
    meta: RequestMeta,
  ): Promise<{ ok: true; twoFactorRequired: boolean }> {
    if (!newPassword || newPassword.length < MIN_PASSWORD_LEN) {
      throw new BadRequestException(
        `Password must be at least ${MIN_PASSWORD_LEN} characters`,
      );
    }
    const row = await this.prisma.passwordResetToken.findUnique({
      where: { tokenHash: this.hash(token) },
    });
    if (!row) throw new UnauthorizedException('Reset link not recognized');
    if (row.consumedAt) throw new UnauthorizedException('Reset link already used');
    if (row.expiresAt < new Date()) {
      throw new UnauthorizedException('Reset link has expired');
    }

    const user = await this.prisma.user.findUnique({ where: { id: row.userId } });
    if (!user || user.deletionStatus === 'COMPLETED') {
      throw new UnauthorizedException('Account unavailable');
    }

    const passwordHash = await argon2.hash(newPassword);
    await this.prisma.$transaction([
      this.prisma.user.update({
        where: { id: user.id },
        data: { passwordHash },
      }),
      this.prisma.passwordResetToken.update({
        where: { id: row.id },
        data: { consumedAt: new Date() },
      }),
      // Force re-login everywhere — a leaked password means leaked sessions.
      this.prisma.refreshToken.updateMany({
        where: { userId: user.id, revokedAt: null },
        data: { revokedAt: new Date() },
      }),
    ]);

    await this.audit
      .record({
        actorUserId: user.id,
        action: 'auth.password.reset',
        entityType: 'User',
        entityId: user.id,
        ip: meta.ip,
        userAgent: meta.userAgent,
      })
      .catch(() => undefined);
    this.events.emit('auth.password.reset', { userId: user.id });

    return { ok: true, twoFactorRequired: user.twoFactorEnabled };
  }
}
