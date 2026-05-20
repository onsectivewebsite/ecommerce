import { OnsectiveClient } from '../client';

export type CertificationKind = 'AUTHORIZED_RESELLER' | 'CERTIFIED_REFURBISHER';
export type CertificationStatus = 'PENDING' | 'ACTIVE' | 'REJECTED' | 'REVOKED' | 'EXPIRED';

export interface CertificationDocument {
  url: string;
  label: string;
}

export interface CertificationRow {
  id: string;
  sellerId: string;
  kind: CertificationKind;
  status: CertificationStatus;
  documents: CertificationDocument[];
  applicantNote: string | null;
  reviewNote: string | null;
  reviewedBy: string | null;
  reviewedAt: string | null;
  expiresAt: string | null;
  createdAt: string;
  updatedAt: string;
  seller?: { id: string; storeName: string; displayName: string };
}

export interface ApplyCertificationPayload {
  kind: CertificationKind;
  documents: CertificationDocument[];
  applicantNote?: string;
}

export interface ReviewCertificationPayload {
  approve: boolean;
  reviewNote?: string;
  validForMonths?: number;
}

export class CertificationsApi {
  constructor(private readonly client: OnsectiveClient) {}

  mine() {
    return this.client.request<CertificationRow[]>('/seller/certifications');
  }
  apply(body: ApplyCertificationPayload) {
    return this.client.request<CertificationRow>('/seller/certifications', { method: 'POST', body });
  }

  adminPending() {
    return this.client.request<CertificationRow[]>('/admin/certifications/pending');
  }
  adminList(params?: { status?: CertificationStatus; sellerId?: string }) {
    return this.client.request<CertificationRow[]>('/admin/certifications', { query: params });
  }
  adminReview(id: string, body: ReviewCertificationPayload) {
    return this.client.request<CertificationRow>(`/admin/certifications/${id}/review`, {
      method: 'POST',
      body,
    });
  }
  adminRevoke(id: string, reason: string) {
    return this.client.request<CertificationRow>(`/admin/certifications/${id}/revoke`, {
      method: 'POST',
      body: { reason },
    });
  }
}
