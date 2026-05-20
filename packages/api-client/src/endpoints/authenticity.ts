import { OnsectiveClient } from '../client';

export type AuthenticityOutcome = 'PASS' | 'FAIL' | 'NEEDS_REVIEW';

export interface AuthenticityEvidence {
  kind: 'PHOTO' | 'SERIAL_SCAN' | 'HOLOGRAM' | 'BOX' | 'NOTE';
  url?: string;
  note?: string;
}

export interface AuthenticityCheckRow {
  id: string;
  inboundItemId: string | null;
  refurbUnitId: string | null;
  serialNumber: string | null;
  outcome: AuthenticityOutcome;
  inspectorUserId: string | null;
  evidence: AuthenticityEvidence[];
  reason: string | null;
  createdAt: string;
}

export interface CreateAuthenticityCheckPayload {
  inboundItemId?: string;
  refurbUnitId?: string;
  serialNumber?: string;
  outcome: AuthenticityOutcome;
  evidence: AuthenticityEvidence[];
  reason?: string;
}

export class AuthenticityApi {
  constructor(private readonly client: OnsectiveClient) {}

  create(body: CreateAuthenticityCheckPayload) {
    return this.client.request<AuthenticityCheckRow>('/warehouse/authenticity/checks', {
      method: 'POST',
      body,
    });
  }
  list(params?: { outcome?: AuthenticityOutcome; serial?: string }) {
    return this.client.request<AuthenticityCheckRow[]>('/warehouse/authenticity/checks', {
      query: params,
    });
  }
  adminQueue() {
    return this.client.request<AuthenticityCheckRow[]>('/admin/authenticity/queue');
  }
}
