import { Injectable } from '@nestjs/common';
import { AiModelKind, AuthenticityOutcome, TradeInGrade } from '@prisma/client';
import type {
  AiSignal,
  AiVisionProvider,
  AuthScoreResult,
  CounterfeitResult,
  GradeScoreResult,
  VisionInputBase,
} from './types';

/**
 * Deterministic in-process provider. Not a stub — it produces useful
 * AI-shaped signals from cheap heuristics so the entire pipeline (suggest
 * → record → render) always works without depending on a remote model
 * service. CI runs against this.
 *
 * Rules used:
 *   - Serial format check (length + character set per known brand prefix).
 *   - Media count check (low media count = lower confidence).
 *   - Attribute presence (batteryHealth, replacedParts fall through to
 *     grade hints).
 *   - Brand on a known list = small confidence bump.
 */
@Injectable()
export class HeuristicVisionProvider implements AiVisionProvider {
  readonly kind = 'heuristic' as const;
  readonly supports: AiModelKind[] = [
    AiModelKind.AUTH,
    AiModelKind.GRADE,
    AiModelKind.COUNTERFEIT,
  ];

  async scoreAuthenticity(input: VisionInputBase): Promise<AuthScoreResult> {
    const signals: AiSignal[] = [];
    let confidence = 0.5;

    const serialOk = this.checkSerialFormat(input.serialNumber, input.brandSlug);
    signals.push({
      name: 'SERIAL_FORMAT_OK',
      score: serialOk ? 1 : 0,
      severity: serialOk ? 'INFO' : 'WARN',
      reason: serialOk ? 'Serial matches expected format' : 'Serial format unusual for this brand',
    });
    confidence += serialOk ? 0.25 : -0.15;

    const mediaCount = input.mediaUrls.length;
    signals.push({
      name: 'MEDIA_COVERAGE',
      score: Math.min(1, mediaCount / 4),
      severity: mediaCount >= 3 ? 'INFO' : 'WARN',
      reason: `${mediaCount} photo(s) provided for inspection`,
    });
    confidence += mediaCount >= 3 ? 0.15 : -0.05;

    if (input.brandSlug && KNOWN_BRANDS.has(input.brandSlug)) {
      signals.push({
        name: 'BRAND_LOGO_OK',
        score: 0.95,
        severity: 'INFO',
        reason: `Known brand: ${input.brandSlug}`,
      });
      confidence += 0.05;
    }

    confidence = Math.max(0, Math.min(1, confidence));
    let suggestion: AuthenticityOutcome;
    if (confidence >= 0.8) suggestion = AuthenticityOutcome.PASS;
    else if (confidence < 0.4) suggestion = AuthenticityOutcome.FAIL;
    else suggestion = AuthenticityOutcome.NEEDS_REVIEW;

    return { suggestion, confidence, signals };
  }

  async scoreCondition(input: VisionInputBase): Promise<GradeScoreResult> {
    const signals: AiSignal[] = [];
    const attrs = input.attributes ?? {};
    const battery = typeof attrs.batteryHealth === 'number' ? (attrs.batteryHealth as number) : null;
    const replaced = Array.isArray(attrs.replacedParts) ? (attrs.replacedParts as string[]) : [];

    let score = 0.85; // start at A
    if (battery != null) {
      const ok = battery >= 90;
      signals.push({
        name: 'BATTERY_HEALTH_OK',
        score: battery / 100,
        severity: ok ? 'INFO' : 'WARN',
        reason: `Declared battery health: ${battery}%`,
      });
      if (battery < 80) score -= 0.2;
      else if (battery < 90) score -= 0.1;
    }
    if (replaced.length > 0) {
      signals.push({
        name: 'REPLACED_PARTS',
        score: Math.min(1, replaced.length / 3),
        severity: 'WARN',
        reason: `Replaced parts declared: ${replaced.join(', ')}`,
      });
      score -= 0.1 * replaced.length;
    }
    if (input.mediaUrls.length < 3) {
      signals.push({
        name: 'MEDIA_COVERAGE',
        score: input.mediaUrls.length / 3,
        severity: 'WARN',
        reason: 'Limited photo coverage — confidence reduced',
      });
      score -= 0.05;
    }

    score = Math.max(0, Math.min(1, score));
    let suggestedGrade: TradeInGrade;
    if (score >= 0.8) suggestedGrade = TradeInGrade.GRADE_A;
    else if (score >= 0.55) suggestedGrade = TradeInGrade.GRADE_B;
    else if (score >= 0.3) suggestedGrade = TradeInGrade.GRADE_C;
    else suggestedGrade = TradeInGrade.REJECT;

    return { suggestedGrade, confidence: score, signals };
  }

  async detectCounterfeit(input: VisionInputBase): Promise<CounterfeitResult> {
    const signals: AiSignal[] = [];
    let risk = 0;

    const serialOk = this.checkSerialFormat(input.serialNumber, input.brandSlug);
    if (!serialOk) {
      signals.push({
        name: 'SERIAL_FORMAT_SUSPICIOUS',
        score: 0.7,
        severity: 'BLOCK',
        reason: 'Serial does not match expected brand format',
      });
      risk += 0.6;
    }
    if (!input.brandSlug || !KNOWN_BRANDS.has(input.brandSlug)) {
      signals.push({
        name: 'BRAND_UNKNOWN',
        score: 0.3,
        severity: 'INFO',
        reason: 'Brand not in verified list — manual confirmation suggested',
      });
      risk += 0.05;
    }
    if (input.mediaUrls.length === 0) {
      signals.push({
        name: 'NO_MEDIA',
        score: 1,
        severity: 'BLOCK',
        reason: 'No photos to inspect',
      });
      risk += 0.4;
    }
    risk = Math.max(0, Math.min(1, risk));
    return { counterfeitRisk: risk, signals };
  }

  private checkSerialFormat(serial: string | null | undefined, brand: string | null | undefined): boolean {
    if (!serial) return false;
    const cleaned = serial.trim();
    if (cleaned.length < 6 || cleaned.length > 24) return false;
    if (!/^[A-Za-z0-9-]+$/.test(cleaned)) return false;
    // Brand-specific extra rules (best-effort, conservative).
    if (brand === 'apple') return /^[A-Z0-9]{10,12}$/.test(cleaned);
    return true;
  }
}

const KNOWN_BRANDS = new Set<string>([
  'apple', 'samsung', 'google', 'sony', 'lg', 'asus', 'dell', 'hp',
  'lenovo', 'microsoft', 'oneplus', 'xiaomi', 'oppo', 'huawei', 'nikon',
  'canon', 'bose', 'sennheiser', 'logitech', 'jbl', 'beats',
]);
