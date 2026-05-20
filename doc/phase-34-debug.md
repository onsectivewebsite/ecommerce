# Phase 34 — Account Recovery — Debug Pass

> What shipped, the invariants, every endpoint, and the deferred follow-ons.

## What shipped

- **Password reset.** `/auth/password/forgot` (enumeration-safe, always 200) mints a 1-hour single-use `PasswordResetToken` and emails a link. `/auth/password/reset` argon2-hashes the new password, consumes the token, and revokes every refresh token. It does **not** touch 2FA — a 2FA-enabled account still goes through `mfaRequired` on next login.
- **2FA lockout recovery.** A user who lost every second factor (TOTP + recovery codes + all passkeys) starts a recovery; after a confirm step and a **72-hour waiting window** the recovery can complete, stripping TOTP enrollment, recovery codes, and WebAuthn credentials.
- **Cancellable end-to-end.** Every recovery email carries a one-click cancel link. Cancel is honored in `PENDING` and `CONFIRMED` states and is idempotent in terminal states.
- **Reminder cadence.** `AccountRecoveryScheduler` (30-min tick, gated by `RECOVERY_SCHEDULER_ENABLED=1`) sends reminders at ~24h and ~48h into the window and a "ready" email once eligible. It also expires stale `PENDING` (>24h unconfirmed) and stale `CONFIRMED` (>7 days past eligibility) requests.
- **Admin oversight.** `/admin/security/recovery-requests` lists in-flight recoveries; an admin can cancel one (`...:id/cancel`), and there's a dev-only manual `scan` trigger.
- **Seven new transactional email templates** covering the whole recovery lifecycle.
- **Frontend**: buyer-web `/forgot-password`, `/reset-password`, `/account-recovery` + `/confirm` `/cancel` `/complete` sub-pages; "Forgot your password?" link on the login page; admin `/security` page now lists in-flight recoveries.

## Invariants

1. **No account enumeration.** Both `/auth/password/forgot` and `/auth/recovery/start` return `{ ok: true }` unconditionally. Unknown emails, deleted accounts (blank `passwordHash`), and accounts-without-2FA (for recovery) all silently no-op.
2. **Password reset never bypasses 2FA.** Resetting the password changes only `passwordHash` and revokes sessions. `twoFactorEnabled` and all enrollments are untouched.
3. **2FA can't be removed before `eligibleAt`.** `complete()` hard-checks `status === CONFIRMED && now >= eligibleAt`. `eligibleAt` is set to `confirmedAt + 72h` at confirm time and never moved.
4. **One active recovery per user.** Starting a new recovery cancels any prior `PENDING`/`CONFIRMED` request for that user.
5. **Tokens are hashes-at-rest.** Every token (reset, confirm, cancel, complete) is stored only as `sha256(raw)`. The raw value lives solely in the emailed link.
6. **Cancel always wins until completion.** As long as the request isn't `COMPLETED`/`CANCELLED`/`EXPIRED`, the cancel link voids it.
7. **Completion revokes all sessions.** Like password reset, `complete()` revokes every refresh token so a hijacked session can't survive the 2FA removal.

## Endpoint inventory

| Method | Path | Auth | Rate limit |
|--------|------|------|------------|
| POST | `/auth/password/forgot` | none | `auth.password-forgot` 5/3600s ip |
| POST | `/auth/password/reset` | none | `auth.password-reset` 10/3600s ip |
| POST | `/auth/recovery/start` | none | `auth.recovery-start` 3/86400s ip |
| POST | `/auth/recovery/confirm` | none | — (token is the proof) |
| POST | `/auth/recovery/cancel` | none | — |
| GET  | `/auth/recovery/status` | none | — |
| POST | `/auth/recovery/complete` | none | `auth.recovery-complete` 5/3600s ip |
| GET  | `/admin/security/recovery-requests` | ADMIN | — |
| POST | `/admin/security/recovery-requests/:id/cancel` | ADMIN | — |
| POST | `/admin/security/recovery-requests/scan` | ADMIN | — (dev) |

## Schema additions

- `PasswordResetToken` (1h TTL, single-use)
- `AccountRecoveryRequest` (status machine, three token hashes, 72h `eligibleAt`)
- `RecoveryRequestStatus` enum: `PENDING → CONFIRMED → COMPLETED`, with `CANCELLED` / `EXPIRED` terminals
- `User.passwordResetTokens` + `User.recoveryRequests` back-relations

## Recovery state machine

```
            start()                 confirm()              complete()
   (none) ─────────► PENDING ─────────────► CONFIRMED ─────────────► COMPLETED
                        │                       │
            cancel()    │           cancel()    │
                        ▼                       ▼
                    CANCELLED               CANCELLED

   scheduler: PENDING >24h ──► EXPIRED
   scheduler: CONFIRMED >7d past eligibleAt ──► EXPIRED
```

## Token rotation note

`AccountRecoveryRequest` stores only token *hashes*, so emails sent *after* `/start` (the confirmed email, reminders, the ready email) can't reproduce the original raw cancel/complete tokens. To keep a working cancel link in every email, the service **re-mints** the cancel/complete tokens each time it sends one — generating a fresh raw token, storing its hash, and embedding the fresh value. Consequence: only the most recent recovery email's cancel link is live; older ones 404. This is acceptable (and good link hygiene) because the owner always has a working cancel link in their newest email. The **confirm** token never rotates, so the `/account-recovery/confirm` countdown page keeps working off its original URL.

`complete()` accepts either the dedicated complete token *or* the confirm token — both were delivered to the same inbox, so allowing the confirm token to finish the flow after the window elapsed adds no attack surface and lets the countdown page complete without a second trip to email.

## Manual test list

1. **Happy password reset.** `/forgot-password` → email → `/reset-password?token=…` → set new password → all sessions dead → sign in with new password.
2. **Reset on a 2FA account.** Same as above, but the success screen mentions 2FA, and login still demands the second factor.
3. **Stale reset link.** Request a reset twice; the first link now 401s ("already used" path via deleteMany of un-consumed tokens).
4. **Expired reset link.** Wait > 1h → 401 "expired".
5. **Enumeration probe.** `/forgot-password` with a nonexistent email → still 200, no email. Same for `/recovery/start`.
6. **Recovery happy path.** `/account-recovery` → email → confirm link → countdown page → (force-advance `eligibleAt` in DB for testing) → `/complete` → 2FA stripped → sign in with password.
7. **Recovery cancel.** Start → confirm → click cancel link → request `CANCELLED`, "recovery cancelled" email sent, 2FA intact.
8. **Recovery before window.** Hit `/auth/recovery/complete` before `eligibleAt` → 401 "waiting period has not elapsed".
9. **Recovery on a no-2FA account.** `/recovery/start` for an account without 2FA → 200, no email (recovery is meaningless; the user should reset the password instead).
10. **Scheduler.** With `RECOVERY_SCHEDULER_ENABLED=1`, confirm a request, backdate `confirmedAt` 25h → next scan sends reminder #1 and bumps `remindersSent`.
11. **Admin cancel.** Start + confirm a recovery → admin `/security` lists it → admin cancels → user emailed, status `CANCELLED`.
12. **Superseding.** Start recovery twice for the same user → the first goes `CANCELLED`, only the second is live.

## Decisions worth highlighting

- **72-hour fixed window.** Matches the Apple "account recovery delay" model. Long enough that a hostile recovery is very likely noticed (we email at confirm, +24h, +48h, and at eligibility), short enough that a genuinely locked-out user isn't abandoned. Not configurable per-account in v1.
- **Password reset is decoupled from 2FA recovery.** Two separate flows because they answer different questions: "I forgot my password" vs "I lost my second factor." Bundling them would mean a password reset silently weakens 2FA — unacceptable.
- **`/recovery/start` sends nothing for no-2FA accounts.** Recovery only removes 2FA; if there's no 2FA there's nothing to do. We still return 200 to avoid leaking which accounts have 2FA.
- **Scheduler is opt-in** (`RECOVERY_SCHEDULER_ENABLED=1`), consistent with the Phase 26/31 schedulers — only one process in a cluster should run it.
- **Confirm token doesn't rotate.** The countdown page needs a stable URL; the confirm token is single-purpose (it can confirm and read status, but not cancel or complete-before-eligibility), so a stable value is safe.
- **`complete()` also strips passkeys.** A user "locked out of 2FA" may have lost their phone, which held both the authenticator app *and* platform passkeys. Recovery clears every second factor so the account is genuinely accessible again; the user re-enrolls afterward.

## Limitations / follow-ons

- **No expedited identity-verified recovery.** The 72h wait is the only path. A future phase could add a document/liveness check for an instant path.
- **No trusted-contact recovery.**
- **Reset/recovery UI is buyer-web only.** Seller-web / admin-web / shipping-web share the API; portal-specific pages are a copy-paste follow-on.
- **Recovery waiting period is a fixed constant**, not risk-tiered.
- **Reminder cadence is fixed** at 24h/48h/ready. Not configurable.
- **No rate limit on `/recovery/confirm` and `/recovery/cancel`** — they're guarded by unguessable 24-byte tokens, and rate-limiting them would let an attacker grief a victim's links. Left unguarded by design.
