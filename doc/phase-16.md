# Phase 16 — AI-assisted Authentication & Grading

Date opened: 2026-05-18
Predecessor: Phase 15 (Trade-in & Circular Loop)

## 1. Why this phase

Phase 14 made every refurb unit pass an `AuthenticityCheck`. Phase 15
made the trade-in pipeline produce a high volume of those checks. Both
phases ship human-driven verdicts, which works at low volume but doesn't
scale: warehouse staff make slower decisions over time, fatigue
introduces false positives/negatives, and there's no easy way to flag
emerging counterfeit patterns across the queue.

Phase 16 adds an AI-assist layer that:

1. **Speeds up routine PASS decisions** by surfacing a high-confidence
   suggestion + reasoning.
2. **Flags counterfeits** with explainable signals (serial mismatch,
   visual anomalies, hologram absence).
3. **Suggests refurb grades** for the trade-in flow so technicians can
   confirm rather than originate.
4. **Records every model run** for audit + future model evaluation.

**Hard rule that the architecture enforces**: AI *suggests*; humans
*decide*. There is no path where the system marks a refurb unit
AVAILABLE without a human-recorded `AuthenticityCheck`. The AI signal
is metadata attached to that decision.

## 2. Scope (in)

### 2.1 AI provider interface
- `AiVisionProvider` interface with three methods:
  - `scoreAuthenticity(input)` → `{ suggestion: PASS|FAIL|NEEDS_REVIEW,
    confidence: 0..1, signals: AiSignal[] }`
  - `scoreCondition(input)` → `{ suggestedGrade: GRADE_A|B|C,
    confidence: 0..1, signals: AiSignal[] }`
  - `detectCounterfeit(input)` → `{ counterfeitRisk: 0..1, signals: AiSignal[] }`
- Default implementation `HeuristicVisionProvider` runs entirely
  in-process. It uses media metadata, serial-number registry lookups,
  and simple rules (matching brand on known list, expected accessory
  set, plausible serial format) so the pipeline always returns deterministic
  signals — no external network call is required for dev/test/CI.
- `RemoteVisionProvider` (opt-in via env) POSTs the request to a
  configured `AI_VISION_URL` with a bearer token. Same interface.
- Provider selection driven by `AI_VISION_PROVIDER` env (`heuristic`
  default, `remote` for production).

### 2.2 Model registry
- `AiModel` table: `{ name, kind (AUTH|GRADE|COUNTERFEIT), version,
  thresholdConfidence, isActive }`. Admin can pause/promote a model.
- Multiple models can coexist; the active model per `kind` is used by
  `AiVisionService`.
- Model rows are write-once except `isActive`/`thresholdConfidence` —
  this preserves the audit trail.

### 2.3 Inference recording
- Every call writes one `AiInferenceRun` row:
  `{ id, modelId, kind, inputRef (refurbUnitId or inboundItemId or
  tradeInOrderId), inputDigest (sha256 of canonical input), result
  JSON, latencyMs, providerKind, createdAt }`.
- The result includes the typed signals (see 2.4).
- Recording is best-effort fire-and-forget; an outage of the AI
  service must not break the human path. (Tested by toggling the
  provider to `error-throw` mode.)

### 2.4 Typed signals
- `AiSignal = { name: string, score: number, severity: INFO|WARN|BLOCK,
  reason: string }`.
- Reserved signal names: `SERIAL_FORMAT_OK`, `SERIAL_REGISTRY_HIT`,
  `HOLOGRAM_DETECTED`, `BRAND_LOGO_OK`, `VISUAL_DEFECT_SCRATCH`,
  `VISUAL_DEFECT_DENT`, `BATTERY_HEALTH_OK`, `PACKAGE_MISMATCH`.
- Frontend renders BLOCK-severity signals as a red banner; WARN as
  yellow inline notes; INFO as gray rows.

### 2.5 Hooks into Phase 14 + Phase 15
- New endpoint `POST /ai/suggest/auth-check` accepts the same payload
  shape that `AuthenticityService.create` expects and returns the AI
  suggestion + the `AiInferenceRun.id`. The frontend renders this *before*
  the staff member submits the check.
- When the staff member submits the `AuthenticityCheck`, the `evidence`
  array is allowed to carry an `aiInferenceRunId` reference; the service
  records it so the audit trail joins the AI suggestion to the human
  decision.
- Mirror flow for grading: `POST /ai/suggest/grading` ↔ `TradeInService.grade`.
- Override flag is implicit — if the human's outcome differs from the
  AI suggestion, we set `AuthenticityCheck.reason` (or
  `TradeInGrading.notes`) to include the AI suggestion and human
  override marker so reviewers can find divergences later.

### 2.6 Buyer/refurbisher signals (cached)
- `RefurbUnit.aiSummary` (JSON, optional) caches the last
  authenticity-check inference so the PDP can render trust UI like
  "Vision-verified · confidence 0.97" without re-running inference.
- PDP shows this as a subtle Verified line under the existing Phase 14
  TrustBadge. (Decision is still the human's PASS — we never claim AI
  authenticated something the human didn't approve.)

### 2.7 Counterfeit watch list
- Repeated `COUNTERFEIT` signals for a serial number write a
  `CounterfeitWatchEntry`. Future inbound for the same serial
  short-circuits to NEEDS_REVIEW automatically (still a human
  decision, but the queue priority is bumped).

## 3. Scope (out)

- Training models. We consume a model API, we don't train one.
- Replacing humans for any PASS decision. Hard out.
- Auto-pricing refurb units (Phase 17).
- Image storage / blob CDN changes — we use the existing media URLs.

## 4. Architectural decisions made up front

### 4.1 Provider abstraction with deterministic default
Following the Phase 1 payment-provider pattern: an interface with a
mock default that lets the whole pipeline run without external
dependencies. The heuristic provider isn't a stub — it's a real
implementation that uses cheap signals (serial format regex, known
brand list, expected accessory keys) to produce useful AI-shaped
signals. CI passes against it; staging swaps to `remote`.

### 4.2 AI never writes the verdict
There is no service method anywhere in Phase 16 that mutates
`RefurbUnit.availability`, writes an `AuthenticityCheck` row, or
writes a `TradeInGrading` row. Phase 16 is read-only with respect to
those tables. The only writes are to `AiInferenceRun` and the new
`AiModel`/`CounterfeitWatchEntry` rows.

### 4.3 Inference recording is fire-and-forget
We catch + log any write failure on `AiInferenceRun` instead of
bubbling it up. The human flow must keep working even if the AI
sidecar is wedged.

### 4.4 Input digest for deduplication + replay
Every inference run records a `sha256` of the canonical input
payload. This enables: (a) idempotency — repeat calls with identical
inputs can be deduped, (b) replay — when a new model version ships we
can replay the last N digests through the new model and compare
verdicts before promoting it.

### 4.5 Cache on RefurbUnit, not on AuthenticityCheck
We cache the last AI summary on `RefurbUnit.aiSummary` rather than on
the AuthenticityCheck row because the PDP reads RefurbUnit and we
want the buyer trust signal to be a cheap join. The AuthenticityCheck
row still carries the `aiInferenceRunId` reference for the audit
trail.

## 5. Acceptance criteria

- `AI_VISION_PROVIDER=heuristic` (default): all three suggest
  endpoints return signals deterministically, no network call made.
  Tests pass without env config.
- `AI_VISION_PROVIDER=remote` + `AI_VISION_URL=...`: requests POST
  to the configured URL with a bearer token; provider failure does
  not break human flow.
- Warehouse staff hit `/trade-in` intake → an AI suggestion appears
  *before* they pick a grade, with confidence + signals. Submitting
  the grade attaches the inference run id to the grading row.
- Same flow on `/warehouse/authenticity/checks`: pre-call returns
  suggestion; submitting the check records the inference id.
- Admin can pause an AiModel from `/ai-models`; subsequent suggest
  calls fall through to the next active model of that kind, or to
  the heuristic provider if none.
- A serial that has accumulated ≥ 2 COUNTERFEIT signals across
  separate runs auto-routes the next inbound for the same serial to
  NEEDS_REVIEW (instead of PASS suggestion).
- `doc/phase-16-debug.md` captures decisions + limits.
