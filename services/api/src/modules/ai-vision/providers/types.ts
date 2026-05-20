import type { AiModelKind, AuthenticityOutcome, TradeInGrade } from '@prisma/client';

export type SignalSeverity = 'INFO' | 'WARN' | 'BLOCK';

export interface AiSignal {
  name: string;
  score: number; // 0..1
  severity: SignalSeverity;
  reason: string;
}

export interface VisionInputBase {
  /** Always set so the result can be recorded against the right entity. */
  inputRefKind: 'refurbUnit' | 'inboundItem' | 'tradeInOrder';
  inputRefId: string;
  serialNumber?: string | null;
  productSlug?: string | null;
  brandSlug?: string | null;
  mediaUrls: string[];
  attributes?: Record<string, unknown>;
}

export interface AuthScoreResult {
  suggestion: AuthenticityOutcome;
  confidence: number;
  signals: AiSignal[];
}

export interface GradeScoreResult {
  suggestedGrade: TradeInGrade;
  confidence: number;
  signals: AiSignal[];
}

export interface CounterfeitResult {
  counterfeitRisk: number;
  signals: AiSignal[];
}

/**
 * Vision provider. The default heuristic implementation is deterministic
 * and runs without external services so dev/test/CI never need network
 * access. A remote implementation talks to a model API.
 */
export interface AiVisionProvider {
  readonly kind: 'heuristic' | 'remote';
  readonly supports: AiModelKind[];

  scoreAuthenticity(input: VisionInputBase): Promise<AuthScoreResult>;
  scoreCondition(input: VisionInputBase): Promise<GradeScoreResult>;
  detectCounterfeit(input: VisionInputBase): Promise<CounterfeitResult>;
}
