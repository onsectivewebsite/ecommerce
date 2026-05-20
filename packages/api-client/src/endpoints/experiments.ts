import { OnsectiveClient } from '../client';

export interface ExperimentVariant {
  id: string;
  name: string;
  weight: number;
}

export interface ExperimentRow {
  id: string;
  key: string;
  status: 'DRAFT' | 'RUNNING' | 'PAUSED' | 'CONCLUDED';
  description: string | null;
  variants: ExperimentVariant[];
  traffic: number;
  updatedAt: string;
}

export interface FeaturesPayload {
  features: Record<string, { defaultValue: string; rules?: unknown[] }>;
}

export class ExperimentsApi {
  constructor(private readonly client: OnsectiveClient) {}

  features(sessionId?: string) {
    return this.client.request<FeaturesPayload>('/experiments/features', {
      noAuth: true,
      headers: sessionId ? { 'x-onsective-sid': sessionId } : undefined,
    });
  }

  exposure(experimentKey: string, sessionId?: string, context?: Record<string, unknown>) {
    return this.client.request<unknown>('/experiments/exposure', {
      method: 'POST',
      body: { experimentKey, context: context ?? {} },
      noAuth: true,
      headers: sessionId ? { 'x-onsective-sid': sessionId } : undefined,
    });
  }

  // Admin
  adminList() {
    return this.client.request<ExperimentRow[]>('/admin/experiments');
  }

  adminUpsert(body: Omit<ExperimentRow, 'id' | 'updatedAt'>) {
    return this.client.request<ExperimentRow>(`/admin/experiments/${encodeURIComponent(body.key)}`, {
      method: 'POST',
      body,
    });
  }
}
