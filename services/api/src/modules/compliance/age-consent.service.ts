import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createHash } from 'crypto';
import { PrismaService } from '../../prisma/prisma.service';
import { newId } from '../../common/id';
import type { AgeConsentResultDto, AgeConsentMethod } from '@onsective/shared-types';

interface ConsentInput {
  userId?: string | null;
  sessionId?: string | null;
  productId?: string | null;
  categoryId?: string | null;
  dob: Date;
  method: AgeConsentMethod;
  ip?: string | null;
  userAgent?: string | null;
}

const CONSENT_TTL_DAYS = 30;

@Injectable()
export class AgeConsentService {
  private readonly salt: string;
  constructor(
    private readonly prisma: PrismaService,
    cfg: ConfigService,
  ) {
    this.salt = cfg.get<string>('AGE_IP_SALT') ?? 'onsective-age-salt-dev';
  }

  static computeAge(dob: Date, asOf: Date = new Date()): number {
    let years = asOf.getFullYear() - dob.getFullYear();
    const md = asOf.getMonth() - dob.getMonth();
    if (md < 0 || (md === 0 && asOf.getDate() < dob.getDate())) years--;
    return years;
  }

  async record(input: ConsentInput): Promise<AgeConsentResultDto> {
    const age = AgeConsentService.computeAge(input.dob);
    if (age < 0 || age > 130) throw new BadRequestException('Invalid DOB');

    if (input.productId) {
      const product = await this.prisma.product.findUnique({ where: { id: input.productId } });
      if (!product) throw new NotFoundException('Product not found');
      const minAge = product.minBuyerAge ?? 0;
      if (age < minAge) {
        throw new BadRequestException(`Buyer must be at least ${minAge} years old`);
      }
    } else if (input.categoryId) {
      const rule = await this.prisma.categoryCompliance.findUnique({
        where: { categoryId: input.categoryId },
      });
      if (rule?.minBuyerAge && age < rule.minBuyerAge) {
        throw new BadRequestException(`Buyer must be at least ${rule.minBuyerAge} years old`);
      }
    }

    const ipHash = this.hashIp(input.ip ?? '');
    await this.prisma.ageConsentEvent.create({
      data: {
        id: newId(),
        userId: input.userId ?? null,
        sessionId: input.sessionId ?? null,
        productId: input.productId ?? null,
        categoryId: input.categoryId ?? null,
        dob: input.dob,
        declaredAge: age,
        method: input.method,
        ipHash,
        userAgent: input.userAgent ?? null,
      },
    });

    const expiresAt = new Date(Date.now() + CONSENT_TTL_DAYS * 86400_000);
    // Cookie value carries the verified age so middleware can short-circuit without a DB hit.
    // It is signed with the same salt; the buyer-web simply mirrors it back as a request hint.
    const cookieValue = this.signCookie(age, expiresAt.getTime());

    return { ok: true, declaredAge: age, cookieValue, expiresAt: expiresAt.toISOString() };
  }

  /**
   * Validates that the buyer has recorded an age-consent within TTL that satisfies `minAge`.
   * Looks up by user or session id; the cookie is a convenience hint only.
   */
  async hasValidConsent(opts: {
    userId?: string | null;
    sessionId?: string | null;
    minAge: number;
  }): Promise<boolean> {
    if (opts.minAge <= 0) return true;
    const or: Array<Record<string, string>> = [];
    if (opts.userId) or.push({ userId: opts.userId });
    if (opts.sessionId) or.push({ sessionId: opts.sessionId });
    if (or.length === 0) return false;
    const since = new Date(Date.now() - CONSENT_TTL_DAYS * 86400_000);
    const row = await this.prisma.ageConsentEvent.findFirst({
      where: {
        OR: or,
        occurredAt: { gte: since },
        declaredAge: { gte: opts.minAge },
      },
      orderBy: { occurredAt: 'desc' },
    });
    return !!row;
  }

  private hashIp(ip: string): string {
    return createHash('sha256').update(`${this.salt}:${ip}`).digest('hex');
  }

  private signCookie(age: number, expiresMs: number): string {
    const payload = `${age}.${expiresMs}`;
    const sig = createHash('sha256').update(`${this.salt}:${payload}`).digest('hex').slice(0, 16);
    return `${payload}.${sig}`;
  }

  verifyCookie(value: string | null | undefined, minAge: number): boolean {
    if (!value || minAge <= 0) return minAge <= 0;
    const parts = value.split('.');
    if (parts.length !== 3) return false;
    const [ageStr, expStr, sig] = parts;
    const age = Number(ageStr);
    const exp = Number(expStr);
    if (!Number.isFinite(age) || !Number.isFinite(exp)) return false;
    if (Date.now() > exp) return false;
    if (age < minAge) return false;
    const expected = createHash('sha256').update(`${this.salt}:${ageStr}.${expStr}`).digest('hex').slice(0, 16);
    return expected === sig;
  }
}
