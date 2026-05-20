# Phase 34 — Account Recovery (Password Reset & 2FA Lockout)

> The platform has no "forgot password" flow — a launch blocker. Phase 34 adds two recovery paths: (1) a standard email-based password reset, and (2) a high-friction 2FA-lockout recovery for users who lost every second factor (authenticator + recovery codes + all passkeys). Both are designed so that control of the email inbox alone never grants instant account takeover.

## Goals

1. **Password reset.** `Forgot password?` → email link → set a new password. Opaque single-use token, 1-hour TTL. Resetting the password revokes all sessions but does **not** disable 2FA — a 2FA-enabled account still needs its second factor to sign in.
2. **No account enumeration.** `/auth/password/forgot` always returns 200 regardless of whether the email exists.
3. **2FA lockout recovery.** A user who can prove email control but has lost all second factors can trigger a recovery that disables 2FA — but only after a mandatory **72-hour waiting period** with reminder emails, so the real owner can cancel a hostile attempt.
4. **Cancellable.** Every recovery email carries a one-click "this wasn't me" cancel link that voids the request immediately and is honored until the moment recovery completes.
5. **Audited.** Every reset and recovery state change is written to the audit log and emits a domain event.
6. **Admin visibility.** Admins can see in-flight recovery requests and, if needed, cancel one.

## Non-Goals

- KBA (knowledge-based auth — "security questions"). Deprecated by NIST; we don't add it.
- ID-document verification for instant recovery. The 72-hour delay is our friction mechanism; a future phase could add an expedited identity-verified path.
- SMS-based reset. Same reasoning as Phase 31 — SMS is a weak channel.
- Magic-link passwordless login as a *primary* auth method (we have passkeys for that — Phase 33).

## Threat model

| Attacker has | Outcome |
|--------------|---------|
| Password only, 2FA on | Blocked — still needs the second factor. Can't recover 2FA without the 72h window + email control. |
| Email inbox only | Can reset the password, but if 2FA is on they still can't sign in. Recovering 2FA takes 72h and pings the owner repeatedly. |
| Email inbox + password, 2FA on | Worst realistic case. They can start recovery, but the 72h delay + reminder emails give the owner a wide window to cancel. After cancel, the attacker's token is dead. |
| Email + password + patient (72h) | Recovery completes. This is the irreducible floor: if you control the email for 3 days unnoticed, you control the account. Mitigated by reminders + the cancel link + a post-completion "your 2FA was removed" alert. |

## Schema

```prisma
enum RecoveryRequestStatus {
  PENDING     // created, waiting for the user to click "yes, continue"
  CONFIRMED   // user confirmed; 72h timer running
  COMPLETED   // 2FA removed
  CANCELLED   // owner (or admin) voided it
  EXPIRED     // PENDING too long, or CONFIRMED window lapsed unused
}

model PasswordResetToken {
  id         String    @id
  userId     String
  tokenHash  String    @unique          // sha256(opaque)
  expiresAt  DateTime
  consumedAt DateTime?
  ip         String?
  userAgent  String?
  createdAt  DateTime  @default(now())
  user       User      @relation(fields: [userId], references: [id], onDelete: Cascade)
  @@index([userId])
  @@index([expiresAt])
}

model AccountRecoveryRequest {
  id               String                @id
  userId           String
  status           RecoveryRequestStatus  @default(PENDING)
  /// Token in the "yes, continue recovery" email link.
  confirmTokenHash String                 @unique
  /// Token in the "this wasn't me / cancel" link — works at any stage.
  cancelTokenHash  String                 @unique
  /// Token used to actually complete recovery once the window has elapsed.
  completeTokenHash String                @unique
  requestedAt      DateTime               @default(now())
  confirmedAt      DateTime?
  /// confirmedAt + 72h. 2FA cannot be removed before this.
  eligibleAt       DateTime?
  completedAt      DateTime?
  cancelledAt      DateTime?
  /// Tracks how many reminder emails we've sent during the waiting window.
  remindersSent    Int                    @default(0)
  ip               String?
  userAgent        String?
  user             User                   @relation(fields: [userId], references: [id], onDelete: Cascade)
  @@index([userId])
  @@index([status, eligibleAt])
}
```

## Password reset flow

```
POST /auth/password/forgot { email }
  → always 200 { ok: true }
  → if the account exists: mint a PasswordResetToken (1h TTL), email a link
    https://<web>/reset-password?token=<opaque>

POST /auth/password/reset { token, newPassword }
  → verify token (exists, not consumed, not expired)
  → argon2-hash newPassword, update user
  → mark token consumed
  → revoke ALL refresh tokens for the user (force re-login)
  → audit + emit `auth.password.reset`
  → return { ok: true, twoFactorRequired: <bool> }   // hint for the UI
```

Notes:
- The reset endpoint does **not** issue tokens. The user is sent to the login page; if they have 2FA, they go through the normal `mfaRequired` flow.
- Minting a second reset token invalidates earlier un-consumed ones for the same user (we delete prior un-consumed rows) so a forwarded old email can't be reused.
- `newPassword` is validated by the same rule as registration (≥ 8 chars, etc.).

## 2FA lockout recovery flow

```
POST /auth/recovery/start { email }
  → always 200 { ok: true }
  → if the account exists AND has 2FA enabled: create AccountRecoveryRequest
    (status PENDING), email the owner with TWO links:
       confirm: /account-recovery/confirm?token=<confirmToken>
       cancel:  /account-recovery/cancel?token=<cancelToken>
  → if the account has no 2FA, we send nothing (recovery is meaningless;
    they should use password reset). Still 200, no enumeration.

POST /auth/recovery/confirm { token }          # token = confirmToken
  → PENDING → CONFIRMED, set confirmedAt = now, eligibleAt = now + 72h
  → email "recovery in progress — completes on <date>, cancel if not you"

POST /auth/recovery/cancel { token }           # token = cancelToken
  → any non-terminal status → CANCELLED
  → email "recovery cancelled"

GET  /auth/recovery/status?token=<completeToken or confirmToken>
  → public read for the frontend to render the countdown / eligibility

POST /auth/recovery/complete { token }         # token = completeToken
  → require status CONFIRMED and now >= eligibleAt
  → disable 2FA: delete TotpEnrollment, RecoveryCode rows, WebAuthnCredential
    rows, set user.twoFactorEnabled = false, revoke all refresh tokens
  → status → COMPLETED
  → email "your two-factor was removed — if this wasn't you, contact support"
  → return { ok: true }
```

After completion the user signs in with their password alone (resetting it first if also forgotten). They can re-enroll 2FA from `/account/security`.

### The waiting-period scheduler

`AccountRecoveryScheduler.scan()` runs on the same cron cadence as the other Phase-26/31 schedulers:
- `PENDING` requests older than 24h with no confirm → `EXPIRED`.
- `CONFIRMED` requests: send a reminder email at ~24h and ~48h after `confirmedAt` (tracked by `remindersSent`), and a "now eligible" email once `now >= eligibleAt`.
- `CONFIRMED` requests left uncompleted 7 days past `eligibleAt` → `EXPIRED` (stale; the user can start over).

## Endpoints summary

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

## Email templates (new)

- `password_reset` — the reset link.
- `account_recovery_requested` — confirm + cancel links.
- `account_recovery_confirmed` — "in progress, completes on <date>", cancel link.
- `account_recovery_reminder` — sent at ~24h / ~48h, cancel link.
- `account_recovery_ready` — "you can now complete recovery", complete + cancel links.
- `account_recovery_completed` — "2FA was removed", contact-support note.
- `account_recovery_cancelled` — "recovery cancelled".

All are `transactional` (Phase 32 taxonomy) — never gated by marketing consent.

## Frontend (buyer-web)

- Login page: a `Forgot password?` link below the password field.
- `/forgot-password` — email input → POST forgot → "check your inbox" confirmation (shown regardless of account existence).
- `/reset-password?token=…` — new-password form → POST reset → success → link to login. If `twoFactorRequired` is true, the success copy mentions they'll still need their authenticator / passkey.
- `/account-recovery` — entry page explaining the 72h process, email input → POST recovery/start.
- `/account-recovery/confirm?token=…` — confirms the request, shows the countdown to `eligibleAt`.
- `/account-recovery/cancel?token=…` — one-click cancel landing page.
- `/account-recovery/complete?token=…` — shows the countdown if not yet eligible, or a "Remove two-factor now" button once eligible.

## API client additions

```ts
class AuthApi {
  passwordForgot(email: string): Promise<{ ok: true }>
  passwordReset(token: string, newPassword: string): Promise<{ ok: true; twoFactorRequired: boolean }>
  recoveryStart(email: string): Promise<{ ok: true }>
  recoveryConfirm(token: string): Promise<{ ok: true; eligibleAt: string }>
  recoveryCancel(token: string): Promise<{ ok: true }>
  recoveryStatus(token: string): Promise<RecoveryStatus>
  recoveryComplete(token: string): Promise<{ ok: true }>
}
class AdminApi {
  recoveryRequests(): Promise<RecoveryRequestRow[]>
  cancelRecoveryRequest(id: string): Promise<{ ok: true }>
}
```

## Out-of-scope follow-ons

- Expedited identity-verified recovery (skip the 72h via document / liveness check).
- Recovery via a designated "trusted contact".
- Configurable waiting period per account-risk tier.
- Seller / admin portals: they use the same endpoints; portal-specific recovery UI is a copy-paste follow-on.
