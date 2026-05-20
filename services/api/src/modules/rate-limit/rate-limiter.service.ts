import { Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  AbuseEventKind,
  RateLimitBlockSource,
  type RateLimitBlock,
} from '@prisma/client';
import Redis from 'ioredis';
import { PrismaService } from '../../prisma/prisma.service';
import { newId } from '../../common/id';
import {
  MemoryBackend,
  RedisBackend,
  type ConsumeResult,
  type RateLimiterBackend,
} from './backends';

const ESCALATION_WINDOW_SEC = 10 * 60;
const ESCALATION_THRESHOLD = 6;
const DEFAULT_AUTO_BLOCK_SEC = 60 * 60;
const AUTH_AUTO_BLOCK_SEC = 24 * 60 * 60;

export interface RateLimitRule {
  rule: string;
  max: number;
  windowSec: number;
  /** Optional override for the auto-block TTL when escalation triggers. */
  autoBlockSec?: number;
}

export interface ConsumeContext {
  key: string;
  ip?: string;
  userAgent?: string;
  userId?: string;
  requestPath?: string;
}

export interface CheckResult extends ConsumeResult {
  blockedUntil: Date | null;
}

@Injectable()
export class RateLimiterService implements OnModuleDestroy {
  private readonly logger = new Logger(RateLimiterService.name);
  private readonly backend: RateLimiterBackend;
  private readonly redis: Redis | null;

  constructor(
    private readonly prisma: PrismaService,
    cfg: ConfigService,
  ) {
    const url = cfg.get<string>('REDIS_URL');
    if (url) {
      try {
        this.redis = new Redis(url, {
          enableOfflineQueue: false,
          maxRetriesPerRequest: 1,
          lazyConnect: false,
        });
        this.redis.on('error', (err) => {
          this.logger.warn(`Redis error (rate limiter): ${err.message}`);
        });
        this.backend = new RedisBackend(this.redis);
        this.logger.log('Rate limiter using Redis backend');
      } catch (e) {
        this.logger.warn(`Failed to init Redis backend (${(e as Error).message}); falling back to memory`);
        this.redis = null;
        this.backend = new MemoryBackend();
      }
    } else {
      this.redis = null;
      this.backend = new MemoryBackend();
      this.logger.log('Rate limiter using in-memory backend (no REDIS_URL set)');
    }
  }

  onModuleDestroy() {
    if (this.redis) {
      void this.redis.quit().catch(() => undefined);
    }
  }

  /**
   * Top-level check used by RateLimitGuard.
   *  1. Reject immediately if there's an active RateLimitBlock for the key.
   *  2. Otherwise try to consume against the sliding window.
   *  3. If not allowed, write an AbuseEvent and bump the violations
   *     counter. If violations exceed the escalation threshold, upsert
   *     an AUTO RateLimitBlock.
   *
   * Fail-open on any infrastructure error: the guard sees `allowed: true`
   * and the request proceeds. We log the failure so ops can investigate.
   */
  async check(rule: RateLimitRule, ctx: ConsumeContext): Promise<CheckResult> {
    try {
      const block = await this.activeBlock(ctx.key);
      if (block) {
        return {
          allowed: false,
          count: 0,
          retryAfterSec: block.blockedUntil
            ? Math.max(1, Math.ceil((block.blockedUntil.getTime() - Date.now()) / 1000))
            : 60,
          resetAt: block.blockedUntil ? Math.floor(block.blockedUntil.getTime() / 1000) : 0,
          blockedUntil: block.blockedUntil,
        };
      }
      const r = await this.backend.tryConsume(ctx.key, rule.max, rule.windowSec);
      if (r.allowed) return { ...r, blockedUntil: null };

      // 429 path: record + maybe escalate.
      await this.recordViolation(rule, ctx);
      const escalationKey = `escalate:${ctx.key}`;
      const violations = await this.backend.incrViolation(escalationKey, ESCALATION_WINDOW_SEC);
      if (violations >= ESCALATION_THRESHOLD) {
        await this.autoBlock(rule, ctx, violations);
      }
      return { ...r, blockedUntil: null };
    } catch (e) {
      this.logger.warn(`rate limit check failed for ${ctx.key}: ${(e as Error).message}`);
      // Fail open. Better to let a request through than 503 the platform
      // because Redis blipped.
      return {
        allowed: true,
        count: 0,
        retryAfterSec: 0,
        resetAt: Math.floor(Date.now() / 1000) + rule.windowSec,
        blockedUntil: null,
      };
    }
  }

  // ---------------- block lifecycle ----------------

  async activeBlock(key: string): Promise<RateLimitBlock | null> {
    const row = await this.prisma.rateLimitBlock.findUnique({ where: { key } });
    if (!row) return null;
    if (row.blockedUntil && row.blockedUntil.getTime() <= Date.now()) {
      // Lazy expire — clean up the row and treat as un-blocked.
      await this.prisma.rateLimitBlock.deleteMany({ where: { id: row.id } });
      return null;
    }
    return row;
  }

  async manualBlock(input: {
    ruleId: string;
    key: string;
    reason: string;
    blockedUntil?: Date | null;
    blockedByUserId?: string;
  }): Promise<RateLimitBlock> {
    const row = await this.prisma.rateLimitBlock.upsert({
      where: { key: input.key },
      create: {
        id: newId(),
        key: input.key,
        ruleId: input.ruleId,
        reason: input.reason,
        source: RateLimitBlockSource.MANUAL,
        blockedUntil: input.blockedUntil ?? null,
        blockedByUserId: input.blockedByUserId ?? null,
      },
      update: {
        ruleId: input.ruleId,
        reason: input.reason,
        source: RateLimitBlockSource.MANUAL,
        blockedUntil: input.blockedUntil ?? null,
        blockedByUserId: input.blockedByUserId ?? null,
      },
    });
    await this.prisma.abuseEvent.create({
      data: {
        id: newId(),
        ruleId: input.ruleId,
        key: input.key,
        kind: AbuseEventKind.MANUAL_BLOCK,
        userId: input.blockedByUserId ?? null,
      },
    }).catch(() => undefined);
    return row;
  }

  async unblock(key: string): Promise<void> {
    await this.prisma.rateLimitBlock.deleteMany({ where: { key } });
  }

  // ---------------- admin read helpers ----------------

  async recentEvents(params: { ruleId?: string; limit?: number } = {}) {
    return this.prisma.abuseEvent.findMany({
      where: params.ruleId ? { ruleId: params.ruleId } : {},
      orderBy: { createdAt: 'desc' },
      take: Math.min(500, Math.max(1, params.limit ?? 100)),
    });
  }

  async listBlocks(params: { activeOnly?: boolean } = {}) {
    if (params.activeOnly) {
      return this.prisma.rateLimitBlock.findMany({
        where: {
          OR: [
            { blockedUntil: null },
            { blockedUntil: { gt: new Date() } },
          ],
        },
        orderBy: { createdAt: 'desc' },
        take: 200,
      });
    }
    return this.prisma.rateLimitBlock.findMany({
      orderBy: { createdAt: 'desc' },
      take: 200,
    });
  }

  // ---------------- private ----------------

  private async recordViolation(rule: RateLimitRule, ctx: ConsumeContext) {
    try {
      await this.prisma.abuseEvent.create({
        data: {
          id: newId(),
          ruleId: rule.rule,
          key: ctx.key,
          kind: AbuseEventKind.RATE_LIMIT_EXCEEDED,
          ip: ctx.ip ?? null,
          userAgent: ctx.userAgent ?? null,
          userId: ctx.userId ?? null,
          requestPath: ctx.requestPath ?? null,
        },
      });
    } catch (e) {
      this.logger.warn(`AbuseEvent write failed: ${(e as Error).message}`);
    }
  }

  private async autoBlock(rule: RateLimitRule, ctx: ConsumeContext, violations: number) {
    const ttlSec =
      rule.autoBlockSec ??
      (rule.rule.startsWith('auth.') ? AUTH_AUTO_BLOCK_SEC : DEFAULT_AUTO_BLOCK_SEC);
    const blockedUntil = new Date(Date.now() + ttlSec * 1000);
    try {
      await this.prisma.rateLimitBlock.upsert({
        where: { key: ctx.key },
        create: {
          id: newId(),
          key: ctx.key,
          ruleId: rule.rule,
          reason: `Auto-block after ${violations} violations in ${ESCALATION_WINDOW_SEC / 60}m`,
          source: RateLimitBlockSource.AUTO,
          blockedUntil,
        },
        update: {
          ruleId: rule.rule,
          reason: `Auto-block after ${violations} violations in ${ESCALATION_WINDOW_SEC / 60}m`,
          source: RateLimitBlockSource.AUTO,
          blockedUntil,
        },
      });
      await this.prisma.abuseEvent.create({
        data: {
          id: newId(),
          ruleId: rule.rule,
          key: ctx.key,
          kind: AbuseEventKind.REPEAT_VIOLATION,
          ip: ctx.ip ?? null,
          userAgent: ctx.userAgent ?? null,
          userId: ctx.userId ?? null,
          requestPath: ctx.requestPath ?? null,
        },
      }).catch(() => undefined);
    } catch (e) {
      this.logger.warn(`auto-block upsert failed: ${(e as Error).message}`);
    }
  }
}
