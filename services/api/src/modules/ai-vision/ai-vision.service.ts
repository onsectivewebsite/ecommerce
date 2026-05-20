import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createHash } from 'crypto';
import {
  AiModelKind,
  AuthenticityOutcome,
  type AiModel,
  type Prisma,
} from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { newId } from '../../common/id';
import { HeuristicVisionProvider } from './providers/heuristic.provider';
import { RemoteVisionProvider } from './providers/remote.provider';
import type {
  AiVisionProvider,
  AuthScoreResult,
  CounterfeitResult,
  GradeScoreResult,
  VisionInputBase,
} from './providers/types';

interface ActorMeta { userId?: string; ip?: string; userAgent?: string }

const COUNTERFEIT_AUTOFLAG_THRESHOLD = 2;

@Injectable()
export class AiVisionService {
  private readonly logger = new Logger(AiVisionService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
    private readonly heuristic: HeuristicVisionProvider,
    private readonly remote: RemoteVisionProvider,
  ) {}

  private pickProvider(): AiVisionProvider {
    const want = (this.config.get<string>('AI_VISION_PROVIDER') ?? 'heuristic').toLowerCase();
    return want === 'remote' ? this.remote : this.heuristic;
  }

  /** Returns the active model row for a kind, or null if none configured. */
  private async activeModel(kind: AiModelKind): Promise<AiModel | null> {
    return this.prisma.aiModel.findFirst({
      where: { kind, isActive: true },
      orderBy: { updatedAt: 'desc' },
    });
  }

  // ---------------- public suggest API ----------------

  async suggestAuthenticity(input: VisionInputBase) {
    // Hard-block based on counterfeit watchlist before even calling the model.
    if (input.serialNumber) {
      const watch = await this.prisma.counterfeitWatchEntry.findUnique({
        where: { serialNumber: input.serialNumber },
      });
      if (watch && watch.signalCount >= COUNTERFEIT_AUTOFLAG_THRESHOLD) {
        const result: AuthScoreResult = {
          suggestion: AuthenticityOutcome.NEEDS_REVIEW,
          confidence: 0.99,
          signals: [{
            name: 'COUNTERFEIT_WATCHLIST',
            score: 1,
            severity: 'BLOCK',
            reason: `Serial has ${watch.signalCount} prior counterfeit signal(s)`,
          }],
        };
        const runId = await this.record(AiModelKind.AUTH, input, result, 0);
        return { ...result, runId };
      }
    }

    const t0 = Date.now();
    const provider = this.pickProvider();
    const result = await provider.scoreAuthenticity(input);
    const runId = await this.record(AiModelKind.AUTH, input, result, Date.now() - t0);
    return { ...result, runId };
  }

  async suggestGrading(input: VisionInputBase) {
    const t0 = Date.now();
    const provider = this.pickProvider();
    const result = await provider.scoreCondition(input);
    const runId = await this.record(AiModelKind.GRADE, input, result, Date.now() - t0);
    return { ...result, runId };
  }

  async detectCounterfeit(input: VisionInputBase) {
    const t0 = Date.now();
    const provider = this.pickProvider();
    const result = await provider.detectCounterfeit(input);
    const runId = await this.record(AiModelKind.COUNTERFEIT, input, result, Date.now() - t0);

    // Update the watchlist when the model reports any BLOCK-severity signal.
    if (input.serialNumber) {
      const block = result.signals.some((s) => s.severity === 'BLOCK');
      if (block) {
        await this.prisma.counterfeitWatchEntry.upsert({
          where: { serialNumber: input.serialNumber },
          create: {
            id: newId(),
            serialNumber: input.serialNumber,
            signalCount: 1,
            lastSignalAt: new Date(),
            lastReason: result.signals.find((s) => s.severity === 'BLOCK')?.reason ?? null,
          },
          update: {
            signalCount: { increment: 1 },
            lastSignalAt: new Date(),
            lastReason: result.signals.find((s) => s.severity === 'BLOCK')?.reason ?? null,
          },
        }).catch((e) => this.logger.warn(`watchlist upsert failed: ${(e as Error).message}`));
      }
    }
    return { ...result, runId };
  }

  /**
   * Persist the inference run. Fire-and-forget on failure: the human flow
   * must never break because we couldn't record AI metadata.
   */
  private async record(
    kind: AiModelKind,
    input: VisionInputBase,
    result: unknown,
    latencyMs: number,
  ): Promise<string | null> {
    try {
      const model = await this.activeModel(kind);
      const provider = this.pickProvider();
      const digest = createHash('sha256').update(this.canonicalize(input)).digest('hex');
      const runId = newId();
      await this.prisma.aiInferenceRun.create({
        data: {
          id: runId,
          modelId: model?.id ?? (await this.ensureFallbackModel(kind, provider.kind)).id,
          kind,
          inputRefKind: input.inputRefKind,
          inputRefId: input.inputRefId,
          inputDigest: digest,
          result: result as object,
          latencyMs,
          providerKind: provider.kind,
        },
      });
      return runId;
    } catch (e) {
      this.logger.warn(`recording AiInferenceRun failed: ${(e as Error).message}`);
      return null;
    }
  }

  /**
   * When no admin-registered model is active for a kind, create a hidden
   * default row so inferences still have a FK target. Created once per
   * (kind, providerKind).
   */
  private async ensureFallbackModel(kind: AiModelKind, providerKind: string): Promise<AiModel> {
    const name = `${providerKind}-default`;
    const existing = await this.prisma.aiModel.findUnique({
      where: { name_version: { name, version: '1.0' } },
    });
    if (existing) return existing;
    return this.prisma.aiModel.create({
      data: {
        id: newId(),
        name,
        kind,
        version: '1.0',
        providerKind,
        isActive: false, // hidden default — admin can promote a real model
      },
    });
  }

  private canonicalize(input: unknown): string {
    return JSON.stringify(input, Object.keys(input as object).sort());
  }

  /**
   * Cache the most recent AUTH inference summary on a RefurbUnit so the
   * PDP can render a verified line without re-running inference.
   */
  async cacheAuthSummary(refurbUnitId: string, result: AuthScoreResult & { runId: string | null }) {
    const model = await this.activeModel(AiModelKind.AUTH);
    await this.prisma.refurbUnit.update({
      where: { id: refurbUnitId },
      data: {
        aiSummary: {
          suggestion: result.suggestion,
          confidence: result.confidence,
          modelName: model?.name ?? `${this.pickProvider().kind}-default`,
          modelVersion: model?.version ?? '1.0',
          runId: result.runId,
          signals: result.signals.slice(0, 5),
          generatedAt: new Date().toISOString(),
        } as object,
      },
    }).catch((e) => this.logger.warn(`cacheAuthSummary failed: ${(e as Error).message}`));
  }

  // ---------------- model registry (admin) ----------------

  listModels() {
    return this.prisma.aiModel.findMany({ orderBy: [{ kind: 'asc' }, { updatedAt: 'desc' }] });
  }

  async registerModel(input: {
    name: string;
    kind: AiModelKind;
    version: string;
    providerKind: string;
    thresholdConfidence?: number;
    notes?: string;
  }, _actor: ActorMeta) {
    return this.prisma.aiModel.create({
      data: {
        id: newId(),
        name: input.name,
        kind: input.kind,
        version: input.version,
        providerKind: input.providerKind,
        thresholdConfidence: input.thresholdConfidence ?? 0.7,
        notes: input.notes ?? null,
        isActive: false,
      },
    });
  }

  async setModelActive(id: string, isActive: boolean) {
    const model = await this.prisma.aiModel.findUnique({ where: { id } });
    if (!model) throw new NotFoundException('Model not found');
    if (isActive) {
      // Only one active model per kind. Deactivate siblings in the same tx.
      await this.prisma.$transaction([
        this.prisma.aiModel.updateMany({ where: { kind: model.kind, isActive: true }, data: { isActive: false } }),
        this.prisma.aiModel.update({ where: { id }, data: { isActive: true } }),
      ]);
    } else {
      await this.prisma.aiModel.update({ where: { id }, data: { isActive: false } });
    }
    return this.prisma.aiModel.findUnique({ where: { id } });
  }

  async setThreshold(id: string, thresholdConfidence: number) {
    return this.prisma.aiModel.update({
      where: { id },
      data: { thresholdConfidence },
    });
  }

  /** Reset a counterfeit watch entry — admin only escape hatch. */
  async clearWatchEntry(serialNumber: string) {
    await this.prisma.counterfeitWatchEntry.deleteMany({ where: { serialNumber } });
    return { ok: true };
  }

  listWatchEntries() {
    return this.prisma.counterfeitWatchEntry.findMany({
      orderBy: { lastSignalAt: 'desc' },
      take: 200,
    });
  }

  /** Recent inferences for an admin debugging view. */
  recentRuns(limit = 50) {
    return this.prisma.aiInferenceRun.findMany({
      orderBy: { createdAt: 'desc' },
      take: Math.min(500, limit),
      include: { model: { select: { name: true, version: true, kind: true } } },
    });
  }
}
