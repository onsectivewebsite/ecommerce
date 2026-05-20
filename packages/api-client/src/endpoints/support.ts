import { OnsectiveClient } from '../client';

export interface InboxThread {
  id: string;
  orderId: string;
  status: string;
  lastMessageAt: string;
  unreadByBuyer: number;
  unreadBySeller: number;
  slaBreached: boolean;
  hoursSinceLast: number;
  order: { id: string; userId: string; totalMinor: number; currency: string; status: string };
  seller: { id: string; displayName: string };
  dispute: { id: string; kind: string; status: string } | null;
}

export class SupportApi {
  constructor(private readonly client: OnsectiveClient) {}

  inbox(filter?: 'escalated' | 'past_sla' | 'all') {
    return this.client.request<InboxThread[]>('/admin/support/inbox', { query: { filter } });
  }
  thread(threadId: string) {
    return this.client.request<unknown>(`/admin/support/threads/${threadId}`);
  }
  note(threadId: string, body: { body: string }) {
    return this.client.request<{ ok: boolean }>(`/admin/support/threads/${threadId}/note`, {
      method: 'POST', body,
    });
  }
  escalate(threadId: string, body: { reason: string }) {
    return this.client.request<{ ok: boolean }>(`/admin/support/threads/${threadId}/escalate`, {
      method: 'POST', body,
    });
  }
  resolve(threadId: string) {
    return this.client.request<{ ok: boolean }>(`/admin/support/threads/${threadId}/resolve`, { method: 'POST' });
  }
  platformRefund(threadId: string, body: { amountMinor: number; reason: string; override?: boolean }) {
    return this.client.request<{ ok: boolean; providerRefundId: string; full: boolean }>(
      `/admin/support/threads/${threadId}/platform-refund`, { method: 'POST', body },
    );
  }
}
