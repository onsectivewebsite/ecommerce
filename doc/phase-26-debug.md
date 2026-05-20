# Phase 26 — Debug Pass

Companion to `phase-26.md`. Decisions made, seams to watch, what to
test before merging.

## 1. The invariants Phase 26 preserves

1. **Soft-delete only.** `anonymize` never deletes the User row.
   It scrubs PII fields in place and sets `deletionStatus=COMPLETED`.
   Orders, payments, payouts, audit logs all keep their FK to the
   anonymized user so business-record retention is intact.
2. **Login is rejected the moment status hits COMPLETED.**
   `AuthService.validate` short-circuits before argon2 verify when
   `deletionStatus=COMPLETED` OR `passwordHash=''`. The synthetic
   email also means a deleted user can't be looked up by their old
   address.
3. **Anonymization is idempotent.** Every step in the
   transaction tolerates "already done". A scheduler tick that
   crashes mid-flight leaves the row in REQUESTED and the next
   tick finishes the work.
4. **Data export URLs are short-lived.** The DB stores the
   storage key, not a presigned URL. Every download request signs
   a fresh 5-minute URL. A 7-day record in the buyer's "exports"
   list is just a key + expiry — not an active download link.
5. **Cancellation only works during grace.** `cancel` refuses if
   `deletionScheduledFor` has already passed. Once the scheduler
   has run, there is no undo.

## 2. Non-obvious decisions

### 2.1 Anonymize, don't cascade-delete
Cascade-deleting `User` would orphan or null-out Order rows, which
break tax-record retention. We scrub PII in place and keep the
row. The trade-off is that a determined operator with DB access
could still see that "Order X belongs to user `deleted-abc12345@onsective.local`"
— but the personally-identifying fields are gone. This matches
how Stripe, Apple, and every other large-platform deletion flow
works.

### 2.2 Stripe customer is detached, not deleted
On anonymize we call `paymentMethods.detach` on each saved card.
We do NOT call `stripe.customers.del` because Stripe retains
historical PaymentIntents for their own financial-audit reasons
and we don't have authority to make them forget. The buyer's
saved-card list is empty after anonymization; future renewals
fail naturally because there's no default method.

### 2.3 Address scrub keeps city/region/country/postal
We replace `line1`/`line2`/`phone`/`fullName` with `(redacted)`
but preserve geographic columns. This lets the platform keep
aggregate analytics (e.g., "what % of returns come from CA")
without retaining PII. It's a soft compromise on Art. 17 vs.
business intelligence; we judged it acceptable because the
remaining fields don't identify the individual.

### 2.4 Export expiry is enforced two ways
- The scheduler sweeps READY rows past `expiresAt` and flips
  them to EXPIRED.
- `listMine` and `signedDownloadUrl` lazy-expire on read,
  so even if the scheduler is off, the UI never exposes a
  stale URL.

Belt + suspenders — the scheduler does the bulk work; the read
path catches edge cases.

### 2.5 Storage key, not URL, in DB
`DataExportRequest.downloadUrl` actually stores the storage key
(e.g., `data-exports/<userId>/<requestId>.json`). The column is
named for the buyer-facing concept but holds the internal
reference. URLs are signed on every download request with a
5-minute TTL.

### 2.6 Idempotent export request
Calling `POST /privacy/data-export` while a PENDING or
BUILDING row exists returns the existing row. Buyers double-
clicking the button can't queue 17 builds.

### 2.7 Deletion status surfaced via /auth/me
We extended `AuthUser` with `deletionStatus` and
`deletionScheduledFor`. The buyer-web TopBar reads them and
shows a "Cancel deletion" banner anywhere the user is signed
in during grace. No extra fetch needed.

### 2.8 30 days is configurable
`PRIVACY_DELETION_GRACE_DAYS` lets ops dial the window. Default
30d matches Apple/Google; some jurisdictions ask for shorter
(7d in some EU member-state interpretations). Just-in-case the
business needs to tune.

### 2.9 Admin has no delete-override
There is no `POST /admin/privacy/delete/:userId` endpoint.
Deletion is a buyer-initiated action only — admin can only
view pending deletions and force the scheduler. This matches
the legal model: the data subject is the only authority to
exercise the right.

### 2.10 ReferralCode disabling
On anonymize we flip the user's ReferralCode to DISABLED so
captured codes that reference this user reject with
`CODE_DISABLED` for any future invitee signups. Old
ReferralRedemption rows remain — they carry the inviter's
points already-paid history.

## 3. Things to test end-to-end

- `POST /privacy/data-export` as a buyer → PENDING row.
  Repeat call → same row.
- Set `DATA_EXPORT_SCHEDULER_ENABLED=1` → wait one tick →
  row goes BUILDING then READY; object lands in MinIO at
  `data-exports/<userId>/<id>.json`.
- `GET /privacy/data-export/<id>/download` → returns a fresh
  5-min signed URL. Open it → JSON archive downloads, contents
  match the buyer's data set.
- Wait past `expiresAt` (or set it manually) and try download
  → 400 "Export expired". Listing flips the row to EXPIRED.
- `POST /privacy/delete` → user row has
  `deletionStatus=REQUESTED`, `deletionScheduledFor=now+30d`.
  Refresh tokens revoked. `/auth/me` shows the new fields.
  Buyer-web TopBar shows the banner.
- `POST /privacy/delete/cancel` → fields cleared, banner gone.
- Set `deletionScheduledFor` to the past, run
  `POST /admin/privacy/scan-due` → anonymize runs:
  - email becomes `deleted-<short>@onsective.local`,
  - name is "Deleted User",
  - all PaymentMethods are DETACHED locally + detached on
    Stripe (verify in the Stripe dashboard),
  - PushDevices are gone,
  - ReferralCode flipped to DISABLED,
  - default addresses scrubbed,
  - `deletionStatus=COMPLETED`, `deletedAt` set, `status=SUSPENDED`.
- Try to log in as the now-anonymized buyer → 401
  "Account deleted".
- Try to log in by old email → 401 "Invalid credentials"
  (lookup returns the synthetic-email row, but the wrong-email
  branch fires).
- Existing Order rows still resolve and render; their
  shipping addresses show `(redacted)` for line1/phone.
- Admin `/admin/privacy` shows pending + recent exports.
- `doc/phase-26-debug.md` captures decisions + limitations.

## 4. Known limitations

- **No anonymous analytics retention beyond geo + counts.**
  We scrub email/name/line1 but keep order timing, prices,
  category, brand. Acceptable for aggregate metrics; if a
  jurisdiction tightens to require fully-anonymous
  aggregates, additional scrubbing would be needed.
- **No retention scheduler beyond compliance-status flip.**
  Anonymized rows live indefinitely. A future "hard delete
  after 7 years" job could be added.
- **No email notification of completed deletion.** The
  buyer is already signed out and the email is synthetic
  by then. We rely on the in-app confirmation when they
  requested it.
- **No cookie consent banner.** Out of scope, deferred.
- **Export archive doesn't include uploaded media bytes.**
  Only the URLs / Media row references. Buyers who want
  the actual review photos or unit photos have to follow
  the URLs.
- **Admin has no per-row export download.** Privacy by
  design — only the data subject can download.
- **JSON schema isn't versioned in code, only on the
  archive itself** (`schemaVersion: 1`). Future shape
  changes should bump the int.

## 5. Files added

- `services/api/src/modules/privacy/data-export.service.ts`
- `services/api/src/modules/privacy/data-export.scheduler.ts`
- `services/api/src/modules/privacy/account-deletion.service.ts`
- `services/api/src/modules/privacy/account-deletion.scheduler.ts`
- `services/api/src/modules/privacy/privacy.controller.ts`
- `services/api/src/modules/privacy/privacy.module.ts`
- `packages/api-client/src/endpoints/privacy.ts`
- `apps/buyer-web/src/app/account/privacy/page.tsx`
- `apps/admin-web/src/app/privacy/page.tsx`

## 6. Files edited

- `services/api/prisma/schema.prisma` — added
  `DataExportRequest`, two enums, and four nullable
  deletion-state columns + back-relation on `User`.
- `services/api/src/app.module.ts` — registered
  `PrivacyModule`.
- `services/api/src/modules/auth/auth.service.ts` —
  refuse login for deleted accounts; surface deletion
  state on `/auth/me`.
- `packages/shared-types/src/dto/auth.ts` —
  `AuthUser.deletionStatus` + `deletionScheduledFor`.
- `packages/api-client/src/index.ts` — re-export `privacy`.
- `apps/buyer-web/src/lib/api.ts` — wired `PrivacyApi`.
- `apps/buyer-web/src/components/TopBar.tsx` —
  deletion-grace banner.
- `apps/buyer-web/src/app/account/page.tsx` — added
  "Privacy" tile.
- `apps/admin-web/src/lib/api.ts` — wired
  `AdminPrivacyApi`.
- `apps/admin-web/src/components/Shell.tsx` — added
  `/privacy` nav.

## 7. Build / type checks not run

Environment has no Node/TS toolchain. Before merging:

```
pnpm prisma migrate dev --name phase_26_privacy
pnpm -r typecheck
pnpm -r build
```

Required env on top of prior phases:

```
DATA_EXPORT_SCHEDULER_ENABLED=1
DATA_EXPORT_TTL_DAYS=7
PRIVACY_DELETION_SCHEDULER_ENABLED=1
PRIVACY_DELETION_GRACE_DAYS=30
```

The migration adds one new table (`DataExportRequest`), two new
enums, and four nullable columns on `User`. No backfill needed —
existing users have all four deletion fields null.
