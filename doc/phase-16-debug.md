# Phase 16 — Debug Pass

Companion to `phase-16.md`. Decisions made, seams to watch, and what
reviewers should test before merging.

## 1. The invariant Phase 16 enforces

**AI suggests. Humans decide.**

Concretely: no service method in `AiVisionService` mutates
`RefurbUnit.availability`, `AuthenticityCheck`, or `TradeInGrading`.
The only writes are to `AiInferenceRun`, `AiModel`, `CounterfeitWatchEntry`,
and `RefurbUnit.aiSummary` (a read-only cache for the PDP). Every
"this device is live for sale" transition still passes through the
human-recorded Phase 14 auth-check.

Reviewers: grep for `aiVision`/`AiVisionService` in any service that
writes to those tables. There should be zero matches.

## 2. Non-obvious decisions

### 2.1 Deterministic heuristic provider, not a stub
`HeuristicVisionProvider` runs the entire pipeline without external
services. It's not a no-op — it returns useful signals from cheap
heuristics (serial format regex, known-brand list, photo coverage,
declared battery/replaced-parts). CI passes against it; staging
swaps to `remote`. Same pattern Phase 1 used for payments.

### 2.2 Remote provider falls back to heuristic on any failure
`RemoteVisionProvider.call()` catches every error path (timeout,
non-2xx, JSON parse) and returns the heuristic result instead. Why:
an outage of the model service must not block warehouse staff
clearing the queue. The fallback is logged but not surfaced as a
hard error in the human UI — the suggestion panel just shows the
heuristic output.

### 2.3 Inference recording is fire-and-forget
`AiVisionService.record()` catches its own write failure and returns
`null`. The suggestion is still returned to the caller; only the
audit-trail row is missed. Trade-off: weaker audit completeness when
the DB is hot, but the human flow never breaks because we couldn't
write a metadata row.

### 2.4 Input digest = sha256 of canonicalized JSON
Every `AiInferenceRun` records `inputDigest`. Two callers with
identical inputs (rare, but possible on retry) write distinct rows
sharing one digest. Future use: idempotent replay when promoting a
new model version. The digest field is indexed.

### 2.5 Hidden default model row
When admins haven't registered any model for a kind, `record()`
lazily creates a hidden `<provider>-default` row (`isActive=false`)
so the inference run has an FK target. This is invisible in the
admin models list filter (the default appears with `isActive=false`
and admins can ignore it). Pros: no migration step needed to install
Phase 16. Cons: the admin will see a "heuristic-default" entry in
the list — labeled clearly enough that it's not confusing.

### 2.6 Counterfeit watchlist short-circuits before model call
`suggestAuthenticity()` checks the `CounterfeitWatchEntry` for the
serial BEFORE invoking the provider. If the count is ≥ 2, we return
`NEEDS_REVIEW` with a `BLOCK`-severity signal immediately. Saves a
model call for known-bad serials and ensures consistent routing to
the admin queue.

### 2.7 Divergence captured in the human's reason/notes field
We don't add a new `aiInferenceRunId` column to AuthenticityCheck or
TradeInGrading. Instead, `maybeDivergenceNote()` looks up the most
recent matching `AiInferenceRun` and, if the human's decision
differs from the AI's suggestion, appends a short note like
`AI suggested PASS (87%); human overrode to FAIL [run:01HV…]`
to the reason/notes. Pros: no schema change, divergences greppable
in the existing audit log. Cons: less structured than a FK column.
Acceptable for this phase.

### 2.8 PDP cache on RefurbUnit.aiSummary
The auth-check suggest endpoint, when called for a `refurbUnit`,
also caches the summary on `RefurbUnit.aiSummary`. The PDP
`RefurbUnitPicker` renders a small green "Vision-verified" line
when the cached suggestion is PASS. The buyer never sees a PASS
suggestion that wasn't followed by a human PASS — the cache is
written at the suggest step, but the buyer-facing render is gated
to PASS only, and the unit's `availability` only flips to
AVAILABLE after the human auth-check.

## 3. Things to test end-to-end

- `AI_VISION_PROVIDER=heuristic` (default): all three suggest
  endpoints return signals deterministically with no network call.
- Set `AI_VISION_PROVIDER=remote` + invalid URL → suggest endpoints
  still return (heuristic fallback) with no thrown error.
- Warehouse staff opens a trade-in order RECEIVED for grading →
  `POST /ai/suggest/grading` fires automatically → suggestion +
  signals render in the AI panel → submitting a different grade
  appends the divergence note to `TradeInGrading.notes`.
- Auth-check on a `refurbUnit` → `RefurbUnit.aiSummary` is
  populated → buyer PDP shows the "Vision-verified" line after
  the human PASS lands.
- Auth-check on a serial with 2+ prior counterfeit BLOCKs →
  suggestion is `NEEDS_REVIEW` even before calling the provider.
- Admin `/ai-vision` → register a model → activate → suggest
  endpoint uses the activated model row (visible in
  `AiInferenceRun.modelId`).
- Pause the active model → fall through to the hidden default →
  human flow keeps working.

## 4. Known limitations

- No model evaluation / replay tooling yet. The `inputDigest`
  groundwork is laid but the "replay last N digests through new
  model and compare" job is deferred.
- No metric counters yet (latency, fallback rate, divergence rate).
  Trivial to add via the existing Phase 12 observability path —
  deferred for the next phase that touches observability.
- The counterfeit watchlist isn't time-windowed. Two BLOCKs from
  three years apart still flag the next inbound. Easy to add a
  90-day window in `suggestAuthenticity()` if it becomes noisy.
- No buyer-facing explanation when a unit is flagged for review.
  The unit just stays QUARANTINED. Acceptable since buyers never
  see QUARANTINED units in listings.

## 5. Files added

- `services/api/src/modules/ai-vision/providers/{types,heuristic.provider,remote.provider}.ts`
- `services/api/src/modules/ai-vision/{ai-vision.service,ai-vision.controller,ai-vision.module,dto}.ts`
- `packages/api-client/src/endpoints/ai-vision.ts`
- `apps/admin-web/src/app/ai-vision/page.tsx`
- `apps/shipping-web/src/components/AiSuggestionPanel.tsx`

## 6. Files edited

- `services/api/prisma/schema.prisma` — added `AiModel`,
  `AiInferenceRun`, `CounterfeitWatchEntry`, `RefurbUnit.aiSummary`,
  enum `AiModelKind`.
- `services/api/src/app.module.ts` — registered `AiVisionModule`.
- `services/api/src/modules/authenticity/authenticity.service.ts` —
  added `maybeDivergenceNote` helper, annotated `reason` with AI
  override note on human disagreement.
- `services/api/src/modules/trade-in/trade-in.service.ts` — added
  `maybeGradeDivergenceNote`, annotated grading `notes` similarly.
- `packages/api-client/src/index.ts` — re-export `ai-vision`.
- `packages/api-client/src/endpoints/refurb-units.ts` — added
  `RefurbUnitAiSummary` + `aiSummary` field.
- `apps/admin-web/src/lib/api.ts`, `apps/shipping-web/src/lib/api.ts` —
  wired `AiVisionApi`.
- `apps/admin-web/src/components/Shell.tsx` — added "AI vision" nav.
- `apps/shipping-web/src/app/trade-in/page.tsx` — fetches AI grade
  suggestion when opening a RECEIVED order; pre-fills technician's
  grade selection with the suggestion.
- `apps/buyer-web/src/components/RefurbUnitPicker.tsx` — renders the
  "Vision-verified · X% confidence" line when `aiSummary.suggestion`
  is PASS.

## 7. Build / type checks not run

Environment has no Node/TS toolchain. Before merging:

```
pnpm prisma migrate dev --name phase_16_ai_vision
pnpm -r typecheck
pnpm -r build
```

The migration introduces `AiModel`, `AiInferenceRun`,
`CounterfeitWatchEntry` and the `RefurbUnit.aiSummary` JSON column.
No data backfill required — `aiSummary` is nullable and starts NULL
for existing rows.
