import { OnsectiveClient } from '../client';

export type WarrantyClaimStatus =
  | 'OPEN'
  | 'APPROVED'
  | 'REJECTED'
  | 'RESOLVED_REPLACE'
  | 'RESOLVED_REPAIR'
  | 'RESOLVED_REFUND';

export interface WarrantyEvidence {
  kind: 'PHOTO' | 'VIDEO' | 'NOTE';
  url: string;
  note?: string;
}

export interface WarrantyClaimRow {
  id: string;
  orderItemId: string;
  claimantUserId: string;
  symptom: string;
  evidence: WarrantyEvidence[];
  status: WarrantyClaimStatus;
  resolutionNote: string | null;
  resolvedBy: string | null;
  resolvedAt: string | null;
  resolutionRef: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface FileWarrantyClaimPayload {
  orderItemId: string;
  symptom: string;
  evidence: WarrantyEvidence[];
}

export interface ResolveWarrantyClaimPayload {
  status: 'RESOLVED_REPAIR' | 'RESOLVED_REPLACE' | 'RESOLVED_REFUND' | 'REJECTED';
  resolutionNote?: string;
  replacementRefurbUnitId?: string;
  refundAmountMinor?: number;
}

export class WarrantyApi {
  constructor(private readonly client: OnsectiveClient) {}

  mine() {
    return this.client.request<WarrantyClaimRow[]>('/warranty/claims');
  }
  file(body: FileWarrantyClaimPayload) {
    return this.client.request<WarrantyClaimRow>('/warranty/claims', { method: 'POST', body });
  }

  adminQueue() {
    return this.client.request<WarrantyClaimRow[]>('/admin/warranty/queue');
  }
  adminApprove(id: string, note?: string) {
    return this.client.request<WarrantyClaimRow>(`/admin/warranty/${id}/approve`, {
      method: 'POST',
      body: { note },
    });
  }
  adminResolve(id: string, body: ResolveWarrantyClaimPayload) {
    return this.client.request<WarrantyClaimRow>(`/admin/warranty/${id}/resolve`, {
      method: 'POST',
      body,
    });
  }
}
