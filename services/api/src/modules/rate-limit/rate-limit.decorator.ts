import { SetMetadata } from '@nestjs/common';

export type RateLimitScope = 'ip' | 'user' | 'ip+user';

export interface RateLimitOptions {
  /** Stable rule identifier — used as the key prefix and audit-log ruleId. */
  rule: string;
  /** Max requests allowed within `windowSec`. */
  max: number;
  /** Sliding-window size in seconds. */
  windowSec: number;
  /** Identity composition for the limiter key. */
  scope?: RateLimitScope;
  /** Override the auto-block TTL when escalation triggers. */
  autoBlockSec?: number;
}

export const RATE_LIMIT_METADATA = 'phase30.rate-limit';

/**
 * Decorator that marks a controller method as rate-limited. Pair with
 * RateLimitGuard at the controller / method / module level.
 */
export const RateLimit = (opts: RateLimitOptions) =>
  SetMetadata(RATE_LIMIT_METADATA, { scope: 'ip', ...opts });
