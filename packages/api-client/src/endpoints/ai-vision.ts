import { OnsectiveClient } from '../client';

export type AiModelKind = 'AUTH' | 'GRADE' | 'COUNTERFEIT';
export type SignalSeverity = 'INFO' | 'WARN' | 'BLOCK';

export interface AiSignal {
  name: string;
  score: number;
  severity: SignalSeverity;
  reason: string;
}

export interface SuggestInput {
  inputRefKind: 'refurbUnit' | 'inboundItem' | 'tradeInOrder';
  inputRefId: string;
  serialNumber?: string;
  productSlug?: string;
  brandSlug?: string;
  mediaUrls: string[];
  attributes?: Record<string, unknown>;
}

export interface AuthSuggestResult {
  suggestion: 'PASS' | 'FAIL' | 'NEEDS_REVIEW';
  confidence: number;
  signals: AiSignal[];
  runId: string | null;
}

export interface GradeSuggestResult {
  suggestedGrade: 'GRADE_A' | 'GRADE_B' | 'GRADE_C' | 'REJECT';
  confidence: number;
  signals: AiSignal[];
  runId: string | null;
}

export interface CounterfeitResult {
  counterfeitRisk: number;
  signals: AiSignal[];
  runId: string | null;
}

export interface AiModelRow {
  id: string;
  name: string;
  kind: AiModelKind;
  version: string;
  thresholdConfidence: number;
  providerKind: string;
  isActive: boolean;
  notes: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface AiInferenceRunRow {
  id: string;
  modelId: string;
  kind: AiModelKind;
  inputRefKind: string;
  inputRefId: string;
  inputDigest: string;
  result: Record<string, unknown>;
  latencyMs: number;
  providerKind: string;
  createdAt: string;
  model?: { name: string; version: string; kind: AiModelKind };
}

export interface CounterfeitWatchEntryRow {
  id: string;
  serialNumber: string;
  signalCount: number;
  lastSignalAt: string;
  lastReason: string | null;
  createdAt: string;
  updatedAt: string;
}

export class AiVisionApi {
  constructor(private readonly client: OnsectiveClient) {}

  suggestAuthCheck(body: SuggestInput) {
    return this.client.request<AuthSuggestResult>('/ai/suggest/auth-check', { method: 'POST', body });
  }
  suggestGrading(body: SuggestInput) {
    return this.client.request<GradeSuggestResult>('/ai/suggest/grading', { method: 'POST', body });
  }
  detectCounterfeit(body: SuggestInput) {
    return this.client.request<CounterfeitResult>('/ai/suggest/counterfeit', { method: 'POST', body });
  }

  // admin
  models() {
    return this.client.request<AiModelRow[]>('/admin/ai-vision/models');
  }
  registerModel(body: {
    name: string;
    kind: AiModelKind;
    version: string;
    providerKind: string;
    thresholdConfidence?: number;
    notes?: string;
  }) {
    return this.client.request<AiModelRow>('/admin/ai-vision/models', { method: 'POST', body });
  }
  setModelActive(id: string, isActive: boolean) {
    return this.client.request<AiModelRow>(`/admin/ai-vision/models/${id}/active`, {
      method: 'PATCH',
      body: { isActive },
    });
  }
  setThreshold(id: string, thresholdConfidence: number) {
    return this.client.request<AiModelRow>(`/admin/ai-vision/models/${id}/threshold`, {
      method: 'PATCH',
      body: { thresholdConfidence },
    });
  }
  watchlist() {
    return this.client.request<CounterfeitWatchEntryRow[]>('/admin/ai-vision/watchlist');
  }
  clearWatch(serialNumber: string) {
    return this.client.request<{ ok: boolean }>(
      `/admin/ai-vision/watchlist/${encodeURIComponent(serialNumber)}`,
      { method: 'DELETE' },
    );
  }
  runs(limit?: number) {
    return this.client.request<AiInferenceRunRow[]>('/admin/ai-vision/runs', { query: { limit } });
  }
}
