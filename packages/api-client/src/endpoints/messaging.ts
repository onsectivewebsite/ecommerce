import { OnsectiveClient } from '../client';

export interface ThreadMessage {
  id: string;
  senderKind: 'BUYER' | 'SELLER' | 'ADMIN' | 'SYSTEM';
  senderUserId: string | null;
  body: string;
  attachments: Array<{ key: string; url: string }>;
  createdAt: string;
}

export interface ThreadView {
  id: string;
  orderId: string;
  status: 'OPEN' | 'WAITING_BUYER' | 'WAITING_SELLER' | 'RESOLVED' | 'ESCALATED';
  buyerUserId: string;
  sellerId: string;
  escalatedAt: string | null;
  mutedSelf: boolean;
  messages: ThreadMessage[];
}

export interface ThreadSummary {
  id: string;
  orderId: string;
  status: string;
  lastMessageAt: string;
  unreadByBuyer: number;
  unreadBySeller: number;
}

export interface PresignedAttachment {
  key: string;
  uploadUrl: string;
  contentType: string;
}

export class MessagingApi {
  constructor(private readonly client: OnsectiveClient) {}

  threads() {
    return this.client.request<ThreadSummary[]>('/messaging/threads');
  }
  orderThread(orderId: string) {
    return this.client.request<ThreadView>(`/messaging/order/${orderId}`);
  }
  thread(threadId: string) {
    return this.client.request<ThreadView>(`/messaging/${threadId}`);
  }
  send(threadId: string, body: { body: string; attachmentKeys?: string[] }) {
    return this.client.request<ThreadMessage>(`/messaging/${threadId}/messages`, { method: 'POST', body });
  }
  markRead(threadId: string) {
    return this.client.request<{ ok: boolean }>(`/messaging/${threadId}/read`, { method: 'POST' });
  }
  mute(threadId: string, muted: boolean) {
    return this.client.request<{ ok: boolean; muted: boolean }>(`/messaging/${threadId}/mute`, {
      method: 'POST', body: { muted },
    });
  }
  presignAttachment(threadId: string, body: { filename: string; contentType: string }) {
    return this.client.request<PresignedAttachment>(`/messaging/${threadId}/attachments/presign`, {
      method: 'POST', body,
    });
  }
}
