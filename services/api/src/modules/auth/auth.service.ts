import {
  ConflictException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import * as argon2 from 'argon2';
import { createHash, randomBytes } from 'crypto';
import { PrismaService } from '../../prisma/prisma.service';
import { newId } from '../../common/id';
import { RegisterDto, LoginDto } from './dto';

export interface JwtPayload {
  sub: string;
  role: 'BUYER' | 'SELLER' | 'ADMIN' | 'SHIPPER';
}

export interface IssuedTokens {
  accessToken: string;
  refreshToken: string;
  refreshExpiresAt: Date;
  accessTtlSec: number;
}

@Injectable()
export class AuthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly jwt: JwtService,
    private readonly cfg: ConfigService,
  ) {}

  private get accessTtlSec(): number {
    return Number(this.cfg.get('JWT_ACCESS_TTL') ?? 900);
  }

  private get refreshTtlSec(): number {
    return Number(this.cfg.get('JWT_REFRESH_TTL') ?? 60 * 60 * 24 * 30);
  }

  private hashRefresh(token: string): string {
    return createHash('sha256').update(token).digest('hex');
  }

  async register(dto: RegisterDto, meta: { ip?: string; userAgent?: string } = {}) {
    const existing = await this.prisma.user.findUnique({ where: { email: dto.email.toLowerCase() } });
    if (existing) throw new ConflictException('Email already in use');
    const passwordHash = await argon2.hash(dto.password);
    const user = await this.prisma.user.create({
      data: {
        id: newId(),
        email: dto.email.toLowerCase(),
        passwordHash,
        firstName: dto.firstName,
        lastName: dto.lastName,
        role: dto.role ?? 'BUYER',
        status: 'ACTIVE',
        // Phase 25: capture the referral code (normalized) + signup IP. The
        // ReferralsService picks these up at first-paid-order time to
        // award both sides if anti-fraud passes.
        referralCodeUsed: dto.referralCode ? dto.referralCode.trim().toUpperCase() : null,
        signupIp: meta.ip ?? null,
      },
    });
    return user;
  }

  async validate(dto: LoginDto) {
    const user = await this.prisma.user.findUnique({ where: { email: dto.email.toLowerCase() } });
    if (!user) throw new UnauthorizedException('Invalid credentials');
    // Phase 26: deleted accounts have a blanked passwordHash and a synthetic
    // email. Reject deterministically rather than falling through to the
    // argon2 verify (which would error on empty hash).
    if (user.deletionStatus === 'COMPLETED' || user.passwordHash === '') {
      throw new UnauthorizedException('Account deleted');
    }
    const ok = await argon2.verify(user.passwordHash, dto.password);
    if (!ok) throw new UnauthorizedException('Invalid credentials');
    if (user.status === 'SUSPENDED') throw new UnauthorizedException('Account suspended');
    return user;
  }

  /** Used by Phase 12 SecurityService for failed-login event capture. */
  async findByEmail(email: string) {
    return this.prisma.user.findUnique({ where: { email: email.toLowerCase() } });
  }

  async issueTokens(userId: string, role: JwtPayload['role'], meta: { ip?: string; userAgent?: string }): Promise<IssuedTokens> {
    const accessToken = await this.jwt.signAsync({ sub: userId, role } satisfies JwtPayload);
    const refreshRaw = randomBytes(32).toString('hex');
    const refreshExpiresAt = new Date(Date.now() + this.refreshTtlSec * 1000);
    await this.prisma.refreshToken.create({
      data: {
        id: newId(),
        userId,
        tokenHash: this.hashRefresh(refreshRaw),
        expiresAt: refreshExpiresAt,
        ip: meta.ip,
        userAgent: meta.userAgent,
      },
    });
    return { accessToken, refreshToken: refreshRaw, refreshExpiresAt, accessTtlSec: this.accessTtlSec };
  }

  async rotateRefresh(rawToken: string, meta: { ip?: string; userAgent?: string }): Promise<IssuedTokens & { userId: string; role: JwtPayload['role'] }> {
    const hash = this.hashRefresh(rawToken);
    const stored = await this.prisma.refreshToken.findUnique({ where: { tokenHash: hash } });
    if (!stored || stored.revokedAt || stored.expiresAt < new Date()) {
      throw new UnauthorizedException('Refresh token invalid');
    }
    const user = await this.prisma.user.findUnique({ where: { id: stored.userId } });
    if (!user) throw new UnauthorizedException('User no longer exists');
    // revoke + reissue (rotation)
    await this.prisma.refreshToken.update({
      where: { id: stored.id },
      data: { revokedAt: new Date() },
    });
    const issued = await this.issueTokens(user.id, user.role as JwtPayload['role'], meta);
    return { ...issued, userId: user.id, role: user.role as JwtPayload['role'] };
  }

  async revokeRefresh(rawToken: string) {
    const hash = this.hashRefresh(rawToken);
    await this.prisma.refreshToken.updateMany({
      where: { tokenHash: hash, revokedAt: null },
      data: { revokedAt: new Date() },
    });
  }

  async getMeAuthUser(userId: string) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      include: { seller: true },
    });
    if (!user) throw new UnauthorizedException('User not found');
    return {
      id: user.id,
      email: user.email,
      firstName: user.firstName,
      lastName: user.lastName,
      role: user.role,
      status: user.status,
      sellerId: user.seller?.id ?? null,
      sellerStatus: user.seller?.status ?? null,
      // Phase 26: surface deletion-grace state so the buyer-web can render
      // a "Cancel deletion" banner anywhere in the app.
      deletionStatus: user.deletionStatus ?? null,
      deletionScheduledFor: user.deletionScheduledFor?.toISOString() ?? null,
      // Phase 31: surface 2FA state so /account/security can render
      // the right enable/disable UI without an extra round-trip.
      twoFactorEnabled: user.twoFactorEnabled,
    };
  }
}
