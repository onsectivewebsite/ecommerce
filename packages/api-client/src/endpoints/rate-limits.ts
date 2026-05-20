import { OnsectiveClient } from '../client';

export type AbuseEventKind = 'RATE_LIMIT_EXCEEDED' | 'REPEAT_VIOLATION' | 'MANUAL_BLOCK';
export type RateLimitBlockSource = 'MANUAL' | 'AUTO';

export interface AbuseEventRow {
  id: string;
  ruleId: string;
  key: string;
  kind: AbuseEventKind;
  ip: string | null;
  userAgent: string | null;
  userId: string | null;
  requestPath: string | null;
  createdAt: string;
}

export interface RateLimitBlockRow {
  id: string;
  key: string;
  ruleId: string;
  reason: string;
  source: RateLimitBlockSource;
  blockedUntil: string | null;
  blockedByUserId: string | null;
  createdAt: string;
  updatedAt: string;
}

export class AdminRateLimitsApi {
  constructor(private readonly client: OnsectiveClient) {}

  events(params?: { ruleId?: string; limit?: number }) {
    return this.client.request<AbuseEventRow[]>('/admin/security/rate-limits/events', {
      query: params,
    });
  }
  blocks(activeOnly = true) {
    return this.client.request<RateLimitBlockRow[]>('/admin/security/rate-limits/blocks', {
      query: { active: activeOnly ? '1' : '0' },
    });
  }
  block(body: { ruleId: string; key: string; reason: string; blockedUntil?: string }) {
    return this.client.request<RateLimitBlockRow>('/admin/security/rate-limits/block', {
      method: 'POST',
      body,
    });
  }
  unblock(key: string) {
    return this.client.request<{ ok: true }>('/admin/security/rate-limits/unblock', {
      method: 'POST',
      body: { key },
    });
  }
}
