# Phase 26 — Privacy, Data Export & Account Deletion

Date opened: 2026-05-18
Predecessor: Phase 25 (Buyer Referrals)

## 1. Why this phase

The platform now holds a meaningful pile of buyer-side PII —
addresses, orders, returns, reviews, wallet ledger, points,
memberships, payment methods, referral graph. Two compliance
obligations that have been unaddressed:

1. **Right to access** (GDPR Art. 15 / CCPA §1798.110). A buyer
   must be able to obtain a copy of their personal data on
   request.
2. **Right to erasure** (GDPR Art. 17 / CCPA §1798.105). A buyer
   must be able to delete their account; the platform must
   actually carry that out, with limited carve-outs for legal
   retention (tax-related order records).

Phase 26 ships both behind a small set of buyer-facing flows and
schedulers — no UI compromises, no half-measures.

## 2. Scope (in)

### 2.1 DataExportRequest
```
DataExportRequest {
  id, userId,
  status: DataExportStatus,   // PENDING | BUILDING | READY | EXPIRED | FAILED
  downloadUrl?, expiresAt?,
  sizeBytes?, error?,
  createdAt, completedAt?
}
```
Each request is one snapshot. Buyers can request again any time;
old READY rows linger until they expire (default 7d).

### 2.2 Account-deletion fields on User
- `deletionStatus DeletionRequestStatus?` — `REQUESTED |
  CANCELLED | COMPLETED`.
- `deletionRequestedAt DateTime?` — when the buyer asked.
- `deletionScheduledFor DateTime?` — when the scheduler will
  anonymize them (default +30 days, env `PRIVACY_DELETION_GRACE_DAYS`).
- `deletedAt DateTime?` — when anonymization actually completed.

We deliberately do NOT add a new `DeletionRequest` table. The
existing `User` row carries the timestamps because a user has
exactly one deletion at a time and we want the read path to be
"check the user row" — same place every other auth gate looks.

### 2.3 DataExportService
- `request(userId)` — creates a PENDING row, returns immediately.
  Idempotency: if a PENDING or BUILDING row exists, return that
  one instead of creating a second.
- `listMine(userId)` — returns READY/EXPIRED rows (and any
  in-flight) for the buyer's history view.
- `processOne(requestId)` — flips to BUILDING, builds the JSON
  archive, writes via `MediaService` (in prod) or a local
  `/tmp/data-exports` dir (in dev), stamps `downloadUrl` +
  `expiresAt`, flips to READY. Errors flip to FAILED with the
  message.
- `markExpired()` — sweeps READY rows with `expiresAt < now`.

The JSON archive includes everything the buyer can see in their
own account plus a few internal-only fields (audit log entries
that reference them as actor, sustainability impacts, referral
redemptions where they're inviter or invitee). Excludes:
- other users' PII,
- raw payment provider tokens,
- internal admin notes on disputes/returns.

### 2.4 DataExportScheduler
- Tick interval: 60 seconds.
- Gate: `DATA_EXPORT_SCHEDULER_ENABLED=1`.
- Per tick: pick up to 5 PENDING rows, process serially. Sweep
  expired READY rows past their `expiresAt`.

### 2.5 AccountDeletionService
- `request(userId, reason?)` — sets the four fields above,
  revokes all refresh tokens, audits. Refuses if there's already
  a REQUESTED row (idempotent — return the existing schedule).
- `cancel(userId)` — only valid while status=REQUESTED and
  `deletionScheduledFor > now`. Clears the four fields, audits.
- `anonymize(userId)` — invoked by the scheduler. Inside a
  Prisma transaction:
  1. Replace `email` with `deleted-<short>@onsective.local`.
  2. Blank `passwordHash` (so future password resets fail).
  3. Replace `firstName`/`lastName` with "Deleted" / "User".
  4. Null `signupIp`, `referralCodeUsed`.
  5. Anonymize `User.addresses` — line1/line2/phone scrubbed to
     "(redacted)", postal/region/country/city preserved so order
     ship-to history still renders aggregates for the platform.
  6. Delete all `PushDevice` rows.
  7. Detach all `PaymentMethod` rows from Stripe + flip to
     DETACHED locally.
  8. Disable the user's `ReferralCode` so future captures
     reject with CODE_DISABLED.
  9. Set `deletionStatus=COMPLETED`, `deletedAt=now`.
  10. Revoke all refresh tokens again (defense in depth).

  Business records (`Order`, `Payment`, `Payout`, `Return`,
  `WarrantyClaim`, etc.) keep their FK pointer to the anonymized
  user. The user's purchase history exists for tax/return-window
  purposes but is no longer linked to identifiable PII.

### 2.6 AccountDeletionScheduler
- Tick interval: 1 hour.
- Gate: `PRIVACY_DELETION_SCHEDULER_ENABLED=1`.
- Picks REQUESTED users where `deletionScheduledFor <= now`
  and runs `anonymize`.

### 2.7 Auth integration
- `AuthService.validate` rejects login if
  `deletionStatus=COMPLETED` with a `Account deleted` error.
- The signed-in `/auth/me` payload includes
  `deletionStatus`, `deletionScheduledFor` when set, so the
  buyer-web can render a "Your account is scheduled to be
  deleted on X. Restore?" banner anywhere during grace.

### 2.8 Buyer page
- `/account/privacy` — two cards:
  - **Download your data**: button → POST /privacy/data-export.
    History list with status + download links + expiry dates.
  - **Delete your account**: button → POST /privacy/delete with
    optional reason text. Confirmation modal showing the 30-day
    grace period. When deletionRequestedAt is set, the card
    flips to a "Cancel deletion" CTA.

### 2.9 Admin oversight
- `/admin/privacy` — read-only page with two tables:
  - Pending deletions (REQUESTED rows + their scheduled-for).
  - Recent exports (last 100) with size + status.
  No admin override or bypass — deletion is a buyer action only.

## 3. Scope (out)

- **Hard delete.** We retain the anonymized row indefinitely
  for FK integrity. A future phase could schedule a
  cascading hard-delete after a longer retention window
  (e.g., 7 years), but it isn't a compliance requirement
  for most jurisdictions once PII is scrubbed.
- **Cookie consent banner.** Out of scope for Phase 26 to
  keep the phase coherent. Sits with marketing tooling.
- **Marketing-consent preference page** (separate from the
  existing per-category notification prefs). Same reason.
- **Family-account / shared deletion.** N/A — one user, one
  deletion.
- **Self-serve account merge.** Out of scope.
- **Right to portability** beyond JSON dump (e.g., direct API
  push to a competitor). JSON is the standard interpretation
  of "machine-readable, commonly-used format" in Art. 20.

## 4. Architectural decisions made up front

### 4.1 Soft delete, not cascade-delete
We anonymize PII in place instead of cascade-deleting the
`User` row. Three reasons:
1. **Business records retention.** Orders carry tax
   liability that must be retained 7+ years in most
   jurisdictions. Deleting the user row would force
   `Order.userId` to null (or cascade), losing the link.
2. **Wallet ledger integrity.** Phase 10 wallet rows are
   signed by their user; orphaning them breaks the ledger.
3. **Audit log auditability.** Sensitive admin actions
   recorded against the user's id stay traceable.

The trade-off is that "deletion" is technically retention
with PII scrubbing — which is what GDPR Art. 17(3)(e)
explicitly carves out as acceptable when retention is
required for compliance with a legal obligation.

### 4.2 30-day grace, scheduler-driven
The buyer requests now, gets a 30-day window to change their
mind, scheduler does the actual scrub. Matches how Apple,
Google, and Stripe handle account deletion. Avoids the
worst-case scenario where a user mid-dispute deletes their
account and loses access to their own evidence.

### 4.3 Stripe customer is detached, not deleted
On anonymize we call `paymentMethods.detach` on each `pm_xxx`
but do NOT delete the Stripe customer object. Stripe holds
the customer + the historical PaymentIntents for their own
financial audit retention; we don't have authority to make
them forget. The buyer-facing PaymentMethod rows flip to
DETACHED and the saved-card list is empty thereafter.

### 4.4 Data export is async with a builder
A buyer with 5 years of order history could have a JSON
archive >10 MB. We don't want to block a request thread.
The scheduler+builder pattern reuses the Phase 21
SchedulerEnabled gate plus the Phase 13 MediaService for
storage. In dev, the builder writes to disk under
`/tmp/data-exports/<requestId>.json` and returns a relative
URL the controller serves; in prod, it writes via Media
and returns a presigned URL.

### 4.5 Export expires after 7 days
GDPR doesn't mandate an expiry; we add one to avoid
indefinite hosting of buyer PII archives that the buyer
already downloaded. Default 7d via
`DATA_EXPORT_TTL_DAYS`.

### 4.6 Login is allowed during grace
A buyer who started deletion can still sign in during the
30-day grace — that's the whole point. The deletion banner
is shown everywhere via the `/auth/me` payload so the
buyer can cancel without hunting for the page.

### 4.7 Anonymization is one-way and verbose
The scheduler logs each step. If anonymization partially
fails, we leave the row in a half-state (the timestamps
stay set, status stays REQUESTED) and a re-run picks it
up. We never set `deletionStatus=COMPLETED` unless every
step succeeded.

## 5. Acceptance criteria

- `POST /privacy/data-export` → DataExportRequest written
  PENDING. Repeat call → returns the existing PENDING row.
- Scheduler picks it up → JSON archive built, URL returned,
  status READY, `expiresAt` set ~7d out.
- Buyer downloads via the URL → archive contains all the
  buyer's PII. Re-fetching after expiry → 404 (or status
  EXPIRED via /privacy/exports).
- `POST /privacy/delete` → user row gets `deletionStatus=REQUESTED`,
  `deletionScheduledFor=now+30d`. Refresh tokens revoked.
- `/auth/me` returns the new fields. Buyer-web shows the
  restore banner.
- `POST /privacy/delete/cancel` before scheduled date →
  fields cleared. Banner disappears.
- Set `deletionScheduledFor` in the past, run the scheduler →
  anonymize runs: email becomes `deleted-…@onsective.local`,
  name "Deleted User", PaymentMethods detached on Stripe,
  PushDevices removed, ReferralCode disabled, addresses
  scrubbed. `deletionStatus=COMPLETED`, `deletedAt` set.
- Try to log in as the now-anonymized buyer → 401 "Account
  deleted".
- Existing Order rows still reference the anonymized user;
  their order history is intact.
- `/admin/privacy` lists pending deletions + recent exports.
- `doc/phase-26-debug.md` captures decisions + limitations.
