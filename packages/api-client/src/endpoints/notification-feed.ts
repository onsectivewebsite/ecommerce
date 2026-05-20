import { OnsectiveClient } from '../client';

export type NotificationKind =
  | 'PLUS_RENEWED'
  | 'PLUS_PAYMENT_FAILED'
  | 'PLUS_EXPIRING_SOON'
  | 'PLUS_EXPIRED'
  | 'REFERRAL_REDEEMED'
  | 'ORDER_PAID'
  | 'ORDER_SHIPPED'
  | 'ORDER_DELIVERED'
  | 'MESSAGE_NEW'
  | 'REVIEW_POSTED'
  | 'SECURITY_SIGN_IN'
  | 'GENERIC';

export interface NotificationRow {
  id: string;
  kind: NotificationKind;
  title: string;
  body: string;
  deepLinkPath: string | null;
  payload: unknown;
  readAt: string | null;
  createdAt: string;
}

export interface NotificationListResult {
  rows: NotificationRow[];
  nextCursor: string | null;
}

export class NotificationFeedApi {
  constructor(private readonly client: OnsectiveClient) {}

  list(params?: { cursor?: string; limit?: number; unreadOnly?: boolean }) {
    const query: Record<string, string | number | undefined> = {
      cursor: params?.cursor,
      limit: params?.limit,
    };
    if (params?.unreadOnly) query.unreadOnly = 'true';
    return this.client.request<NotificationListResult>('/notifications', { query });
  }

  unreadCount() {
    return this.client.request<{ count: number }>('/notifications/unread-count');
  }

  markRead(id: string) {
    return this.client.request<{ ok: true }>(`/notifications/${id}/read`, { method: 'POST' });
  }

  markAllRead() {
    return this.client.request<{ count: number }>('/notifications/read-all', { method: 'POST' });
  }
}
