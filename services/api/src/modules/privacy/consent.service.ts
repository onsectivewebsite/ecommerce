import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createHash, randomBytes } from 'crypto';
import type {
  ConsentRecord,
  ConsentRegion,
  ConsentSource,
} from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { newId } from '../../common/id';

/**
 * Phase 32 consent service.
 *
 * One record per identity (logged-in user OR anonymous browser session). On
 * login we resolve the anonymous record into the user one. Every write goes
 * through `upsertCategories` so we get a consistent ConsentEvent audit trail
 * across all sources.
 */

const ANON_TOKEN_TTL_DAYS = 180;
const UNSUB_TOKEN_TTL_DAYS = 90;

export type CategoryDelta = Partial<{
  functional: boolean;
  analytics: boolean;
  marketing: boolean;
  marketingEmail: boolean;
  marketingSms: boolean;
  marketingPush: boolean;
}>;

export interface CaptureInput {
  userId?: string | null;
  anonId?: string | null;
  region: ConsentRegion;
  source: ConsentSource;
  policyVersion: string;
  categories: CategoryDelta;
  ip?: string | null;
  userAgent?: string | null;
}

@Injectable()
export class ConsentService {
  private readonly logger = new Logger(ConsentService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly cfg: ConfigService,
  ) {}

  get currentPolicyVersion(): string {
    return this.cfg.get<string>('CONSENT_POLICY_VERSION') ?? '2026-05-19';
  }

  private hashIp(ip?: string | null): string | null {
    if (!ip) return null;
    return createHash('sha256').update(`ons-consent::${ip}`).digest('hex').slice(0, 32);
  }

  private toSnapshot(r: ConsentRecord) {
    return {
      essential: r.essential,
      functional: r.functional,
      analytics: r.analytics,
      marketing: r.marketing,
      marketingEmail: r.marketingEmail,
      marketingSms: r.marketingSms,
      marketingPush: r.marketingPush,
      region: r.region,
      policyVersion: r.policyVersion,
      source: r.source,
    };
  }

  /**
   * Load the canonical record for a request: logged-in user wins, falls back
   * to anon-cookie ID. Returns null when neither identity has consented yet.
   */
  async load(opts: { userId?: string | null; anonId?: string | null }): Promise<ConsentRecord | null> {
    if (opts.userId) {
      const row = await this.prisma.consentRecord.findUnique({
        where: { userId: opts.userId },
      });
      if (row) return row;
    }
    if (opts.anonId) {
      return this.prisma.consentRecord.findUnique({ where: { anonId: opts.anonId } });
    }
    return null;
  }

  /**
   * Capture or replace a consent record. Auditable.
   */
  async capture(input: CaptureInput): Promise<ConsentRecord> {
    if (!input.userId && !input.anonId) {
      throw new BadRequestException('Either userId or anonId is required');
    }
    if (input.userId && input.anonId) {
      // Login-time resolution should call resolveOnLogin first; we treat a
      // mixed payload as user-wins by ignoring anonId.
      input = { ...input, anonId: null };
    }

    const existing = await this.load({ userId: input.userId, anonId: input.anonId });
    const before = existing ? this.toSnapshot(existing) : null;
    const ipHash = this.hashIp(input.ip);

    const data = {
      region: input.region,
      policyVersion: input.policyVersion,
      essential: true,
      functional: input.categories.functional ?? existing?.functional ?? false,
      analytics: input.categories.analytics ?? existing?.analytics ?? false,
      marketing: input.categories.marketing ?? existing?.marketing ?? false,
      marketingEmail:
        input.categories.marketingEmail ?? existing?.marketingEmail ?? false,
      marketingSms: input.categories.marketingSms ?? existing?.marketingSms ?? false,
      marketingPush:
        input.categories.marketingPush ?? existing?.marketingPush ?? false,
      source: input.source,
      ipHash,
      userAgent: input.userAgent ?? null,
    };

    const record = existing
      ? await this.prisma.consentRecord.update({
          where: { id: existing.id },
          data,
        })
      : await this.prisma.consentRecord.create({
          data: {
            id: newId(),
            userId: input.userId ?? null,
            anonId: input.anonId ?? null,
            ...data,
          },
        });

    await this.prisma.consentEvent.create({
      data: {
        id: newId(),
        consentId: record.id,
        userId: input.userId ?? null,
        anonId: input.anonId ?? null,
        source: input.source,
        region: input.region,
        policyVersion: input.policyVersion,
        before: (before ?? {}) as object,
        after: this.toSnapshot(record) as object,
        ipHash,
        userAgent: input.userAgent ?? null,
      },
    });

    await this.audit
      .record({
        actorUserId: input.userId ?? null,
        action: existing ? 'consent.updated' : 'consent.created',
        entityType: 'ConsentRecord',
        entityId: record.id,
        before,
        after: this.toSnapshot(record),
        ip: input.ip,
        userAgent: input.userAgent,
      })
      .catch((e) => this.logger.warn(`audit consent failed: ${e}`));

    return record;
  }

  /**
   * Called from AuthService.login (and register) to fold an anonymous browser
   * record into the user-keyed one. We keep the user-keyed record if both
   * exist; otherwise we re-key the anon row to the user.
   */
  async resolveOnLogin(userId: string, anonId: string | null) {
    if (!anonId) return;
    const [userRow, anonRow] = await Promise.all([
      this.prisma.consentRecord.findUnique({ where: { userId } }),
      this.prisma.consentRecord.findUnique({ where: { anonId } }),
    ]);
    if (!anonRow) return;
    if (userRow) {
      // User-side wins. Drop the anon row.
      await this.prisma.consentRecord.delete({ where: { id: anonRow.id } });
      return;
    }
    await this.prisma.consentRecord.update({
      where: { id: anonRow.id },
      data: { userId, anonId: null },
    });
  }

  /**
   * Partial preference update for a logged-in user (called by /privacy/preferences).
   */
  async updatePreferences(
    userId: string,
    categories: CategoryDelta,
    meta: { ip?: string | null; userAgent?: string | null },
  ) {
    const existing = await this.prisma.consentRecord.findUnique({ where: { userId } });
    if (!existing) {
      throw new NotFoundException('No consent record on file');
    }
    return this.capture({
      userId,
      region: existing.region,
      source: 'PREFERENCES_PAGE',
      policyVersion: this.currentPolicyVersion,
      categories,
      ip: meta.ip,
      userAgent: meta.userAgent,
    });
  }

  /**
   * Lightweight read used by EmailService at send time. False also when the
   * user has no record at all — marketing requires explicit positive consent.
   */
  async canSendMarketingEmail(userId: string): Promise<boolean> {
    const row = await this.prisma.consentRecord.findUnique({
      where: { userId },
      select: { marketing: true, marketingEmail: true },
    });
    return !!(row?.marketing && row?.marketingEmail);
  }

  // ───────────────────────── Unsubscribe tokens ─────────────────────────

  /**
   * Mint a one-shot unsubscribe token for a single category. Token is
   * cryptographically random; we store sha256(token) and hand back the raw
   * value to embed in the email link.
   */
  async mintUnsubscribeToken(userId: string, category: string): Promise<string> {
    const raw = randomBytes(24).toString('base64url');
    await this.prisma.unsubscribeToken.create({
      data: {
        id: newId(),
        userId,
        tokenHash: createHash('sha256').update(raw).digest('hex'),
        category,
        expiresAt: new Date(Date.now() + UNSUB_TOKEN_TTL_DAYS * 86400 * 1000),
      },
    });
    return raw;
  }

  async lookupUnsubscribe(rawToken: string) {
    const hash = createHash('sha256').update(rawToken).digest('hex');
    const row = await this.prisma.unsubscribeToken.findUnique({
      where: { tokenHash: hash },
      include: { user: { select: { email: true } } },
    });
    if (!row) throw new NotFoundException('Unsubscribe link not recognized');
    if (row.consumedAt) {
      return { email: row.user.email, category: row.category, alreadyDone: true };
    }
    if (row.expiresAt < new Date()) {
      throw new BadRequestException('Unsubscribe link has expired');
    }
    return { email: row.user.email, category: row.category, alreadyDone: false };
  }

  async consumeUnsubscribe(rawToken: string, meta: { ip?: string | null; userAgent?: string | null }) {
    const hash = createHash('sha256').update(rawToken).digest('hex');
    const row = await this.prisma.unsubscribeToken.findUnique({ where: { tokenHash: hash } });
    if (!row) throw new NotFoundException('Unsubscribe link not recognized');
    if (row.consumedAt) {
      return { ok: true as const, category: row.category, alreadyDone: true };
    }
    if (row.expiresAt < new Date()) {
      throw new BadRequestException('Unsubscribe link has expired');
    }
    const delta: CategoryDelta = {};
    switch (row.category) {
      case 'marketingEmail':
        delta.marketingEmail = false;
        break;
      case 'marketingSms':
        delta.marketingSms = false;
        break;
      case 'marketingPush':
        delta.marketingPush = false;
        break;
      case 'marketing':
        delta.marketing = false;
        delta.marketingEmail = false;
        delta.marketingSms = false;
        delta.marketingPush = false;
        break;
      default:
        throw new BadRequestException(`Unknown unsubscribe category: ${row.category}`);
    }
    const existing = await this.prisma.consentRecord.findUnique({ where: { userId: row.userId } });
    await this.capture({
      userId: row.userId,
      region: existing?.region ?? 'REST',
      source: 'UNSUBSCRIBE_LINK',
      policyVersion: this.currentPolicyVersion,
      categories: delta,
      ip: meta.ip,
      userAgent: meta.userAgent,
    });
    await this.prisma.unsubscribeToken.update({
      where: { id: row.id },
      data: { consumedAt: new Date() },
    });
    return { ok: true as const, category: row.category, alreadyDone: false };
  }

  // ───────────────────────── Admin metrics ─────────────────────────

  async metrics() {
    const [byRegion, totals, recent] = await Promise.all([
      this.prisma.consentRecord.groupBy({
        by: ['region'],
        _count: { _all: true },
        _sum: { /* booleans not aggregatable; we just count */ } as never,
      }),
      this.prisma.consentRecord.count(),
      this.prisma.consentEvent.findMany({
        where: { source: 'UNSUBSCRIBE_LINK' },
        orderBy: { createdAt: 'desc' },
        take: 50,
      }),
    ]);
    const optInCounts = await this.prisma.$queryRawUnsafe<
      Array<{
        region: ConsentRegion;
        functional: bigint;
        analytics: bigint;
        marketing: bigint;
        marketing_email: bigint;
      }>
    >(`
      SELECT region,
             SUM(CASE WHEN functional THEN 1 ELSE 0 END)::bigint AS functional,
             SUM(CASE WHEN analytics THEN 1 ELSE 0 END)::bigint AS analytics,
             SUM(CASE WHEN marketing THEN 1 ELSE 0 END)::bigint AS marketing,
             SUM(CASE WHEN "marketingEmail" THEN 1 ELSE 0 END)::bigint AS marketing_email
      FROM "ConsentRecord"
      GROUP BY region
    `);
    return {
      totalRecords: totals,
      regions: byRegion.map((r) => ({ region: r.region, count: r._count._all })),
      optInCounts: optInCounts.map((r) => ({
        region: r.region,
        functional: Number(r.functional),
        analytics: Number(r.analytics),
        marketing: Number(r.marketing),
        marketingEmail: Number(r.marketing_email),
      })),
      recentOptOuts: recent,
    };
  }

  // ───────────────────────── Helpers ─────────────────────────

  static generateAnonId(): string {
    return randomBytes(16).toString('base64url');
  }

  static ANON_COOKIE_TTL_DAYS = ANON_TOKEN_TTL_DAYS;
}
