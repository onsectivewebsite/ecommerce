import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AiModelKind } from '@prisma/client';
import { HeuristicVisionProvider } from './heuristic.provider';
import type {
  AiVisionProvider,
  AuthScoreResult,
  CounterfeitResult,
  GradeScoreResult,
  VisionInputBase,
} from './types';

/**
 * Talks to an external vision API. The contract: POST the input as JSON
 * with a bearer token; the server returns a result shape matching the
 * provider methods. On any failure (timeout, non-2xx, JSON parse error)
 * we fall through to the heuristic provider so the human flow keeps
 * working. The failure is logged + emitted as a metric upstream.
 */
@Injectable()
export class RemoteVisionProvider implements AiVisionProvider {
  readonly kind = 'remote' as const;
  readonly supports: AiModelKind[] = [
    AiModelKind.AUTH,
    AiModelKind.GRADE,
    AiModelKind.COUNTERFEIT,
  ];

  private readonly logger = new Logger(RemoteVisionProvider.name);

  constructor(
    private readonly config: ConfigService,
    private readonly fallback: HeuristicVisionProvider,
  ) {}

  scoreAuthenticity(input: VisionInputBase): Promise<AuthScoreResult> {
    return this.call<AuthScoreResult>('auth', input, () => this.fallback.scoreAuthenticity(input));
  }
  scoreCondition(input: VisionInputBase): Promise<GradeScoreResult> {
    return this.call<GradeScoreResult>('grade', input, () => this.fallback.scoreCondition(input));
  }
  detectCounterfeit(input: VisionInputBase): Promise<CounterfeitResult> {
    return this.call<CounterfeitResult>('counterfeit', input, () => this.fallback.detectCounterfeit(input));
  }

  private async call<T>(
    endpoint: 'auth' | 'grade' | 'counterfeit',
    input: VisionInputBase,
    fallback: () => Promise<T>,
  ): Promise<T> {
    const baseUrl = this.config.get<string>('AI_VISION_URL');
    const token = this.config.get<string>('AI_VISION_TOKEN');
    if (!baseUrl || !token) {
      this.logger.warn('Remote vision provider misconfigured — using heuristic fallback');
      return fallback();
    }
    try {
      const ctl = new AbortController();
      const timeout = setTimeout(() => ctl.abort(), 4000);
      const res = await fetch(`${baseUrl.replace(/\/$/, '')}/${endpoint}`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify(input),
        signal: ctl.signal,
      });
      clearTimeout(timeout);
      if (!res.ok) {
        this.logger.warn(`Remote vision ${endpoint} returned ${res.status} — falling back`);
        return fallback();
      }
      return (await res.json()) as T;
    } catch (e) {
      this.logger.warn(`Remote vision ${endpoint} failed: ${(e as Error).message} — falling back`);
      return fallback();
    }
  }
}
