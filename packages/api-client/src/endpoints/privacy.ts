import { OnsectiveClient } from '../client';

export type DataExportStatus = 'PENDING' | 'BUILDING' | 'READY' | 'EXPIRED' | 'FAILED';
export type DeletionRequestStatus = 'REQUESTED' | 'CANCELLED' | 'COMPLETED';

export interface DataExportRequestRow {
  id: string;
  status: DataExportStatus;
  sizeBytes: number | null;
  expiresAt: string | null;
  createdAt: string;
  completedAt: string | null;
  error: string | null;
}

export interface AdminDataExportRow extends DataExportRequestRow {
  user: { id: string; email: string; name: string };
}

export interface PendingDeletionRow {
  id: string;
  email: string;
  firstName: string;
  lastName: string;
  deletionRequestedAt: string;
  deletionScheduledFor: string;
}

// ─── Phase 32: Consent ───────────────────────────────────────────────────

export type ConsentRegion = 'EU' | 'UK' | 'CA' | 'REST';
export type ConsentSource =
  | 'BANNER'
  | 'PREFERENCES_PAGE'
  | 'UNSUBSCRIBE_LINK'
  | 'ADMIN_OVERRIDE'
  | 'IMPORT';

export interface ConsentRecordRow {
  id: string;
  userId: string | null;
  anonId: string | null;
  region: ConsentRegion;
  policyVersion: string;
  essential: boolean;
  functional: boolean;
  analytics: boolean;
  marketing: boolean;
  marketingEmail: boolean;
  marketingSms: boolean;
  marketingPush: boolean;
  source: ConsentSource;
  createdAt: string;
  updatedAt: string;
}

export interface ConsentReadResult {
  record: ConsentRecordRow | null;
  detectedRegion: ConsentRegion;
  policyVersion: string;
  anonId: string | null;
}

export interface ConsentCategories {
  functional?: boolean;
  analytics?: boolean;
  marketing?: boolean;
  marketingEmail?: boolean;
  marketingSms?: boolean;
  marketingPush?: boolean;
}

export interface UnsubscribeLookupResult {
  email: string;
  category: string;
  alreadyDone: boolean;
}

export interface ConsentMetrics {
  totalRecords: number;
  regions: Array<{ region: ConsentRegion; count: number }>;
  optInCounts: Array<{
    region: ConsentRegion;
    functional: number;
    analytics: number;
    marketing: number;
    marketingEmail: number;
  }>;
  recentOptOuts: Array<{
    id: string;
    consentId: string;
    userId: string | null;
    source: ConsentSource;
    region: ConsentRegion;
    createdAt: string;
  }>;
}

export class PrivacyApi {
  constructor(private readonly client: OnsectiveClient) {}

  requestDataExport() {
    return this.client.request<DataExportRequestRow>('/privacy/data-export', { method: 'POST' });
  }
  listMyExports() {
    return this.client.request<DataExportRequestRow[]>('/privacy/data-export');
  }
  downloadUrl(id: string) {
    return this.client.request<{ url: string }>(`/privacy/data-export/${id}/download`);
  }
  requestDeletion(body?: { reason?: string }) {
    return this.client.request<{ deletionStatus: DeletionRequestStatus; deletionScheduledFor: string | null }>(
      '/privacy/delete',
      { method: 'POST', body: body ?? {} },
    );
  }
  cancelDeletion() {
    return this.client.request<{ deletionStatus: DeletionRequestStatus | null; deletionScheduledFor: string | null }>(
      '/privacy/delete/cancel',
      { method: 'POST' },
    );
  }

  // ─── Phase 32: Consent ───────────────────────────────────────────────
  getConsent() {
    return this.client.request<ConsentReadResult>('/privacy/consent');
  }
  captureConsent(body: ConsentCategories & { preset?: string }) {
    return this.client.request<ConsentRecordRow>('/privacy/consent', {
      method: 'POST',
      body,
    });
  }
  updatePreferences(body: ConsentCategories) {
    return this.client.request<ConsentRecordRow>('/privacy/preferences', {
      method: 'PATCH',
      body,
    });
  }
  lookupUnsubscribe(token: string) {
    return this.client.request<UnsubscribeLookupResult>(
      '/privacy/unsubscribe/lookup',
      { query: { token } },
    );
  }
  consumeUnsubscribe(token: string) {
    return this.client.request<{ ok: true; category: string; alreadyDone: boolean }>(
      '/privacy/unsubscribe',
      { method: 'POST', body: { token } },
    );
  }
}

export class AdminPrivacyApi {
  constructor(private readonly client: OnsectiveClient) {}

  pendingDeletions() {
    return this.client.request<PendingDeletionRow[]>('/admin/privacy/pending-deletions');
  }
  recentExports(params?: { limit?: number; status?: DataExportStatus }) {
    return this.client.request<AdminDataExportRow[]>('/admin/privacy/recent-exports', {
      query: params,
    });
  }
  scanDue() {
    return this.client.request<{ scanned: number; anonymized: number; failed: number }>(
      '/admin/privacy/scan-due',
      { method: 'POST' },
    );
  }
  consentMetrics() {
    return this.client.request<ConsentMetrics>('/admin/privacy/consent/metrics');
  }
}
