# Phase 31 — Two-Factor Authentication (TOTP)

> Closes the security gap that started with Phase 30 (rate limiting). Adds RFC 6238 TOTP as a second factor on the login flow, with recovery codes for lock-out resilience and an admin reset path. No SMS — TOTP-only via authenticator apps (Google Authenticator, 1Password, Authy, etc.). No stubs in auth: the implementation generates real secrets, verifies real OTPs, and rejects expired challenges.

## Goals

1. **Strong second factor on sign-in.** Buyer can opt-in to TOTP; admin accounts can later be made required.
2. **Recovery codes.** 10 single-use codes issued at enrollment, stored as argon2 hashes. Regeneratable.
3. **No persistent device cookie.** Each login asks for the OTP. (We can add device-trust later if needed; not in this phase.)
4. **Admin reset.** An admin can disable 2FA on a user account if they're locked out and recovery codes are exhausted/lost.
5. **Idempotent enrollment.** Starting enrollment twice replaces the pending secret. Verifying activates it. Disable requires fresh OTP or password re-auth.

## Non-Goals

- WebAuthn / passkeys (separate, larger phase).
- SMS / email OTP (worse security, regulatory headaches).
- Device-trust ("remember this device for 30 days") cookie.
- 2FA on seller-web / admin-web sign-in flows (they share the same `/auth/login` endpoint, so they get it for free — just no portal-specific enrollment UI in this phase, only buyer-web).

## Schema

```prisma
enum TwoFactorEnrollmentStatus { PENDING, ACTIVE }
enum TwoFactorChallengeKind    { LOGIN, DISABLE }

model TotpEnrollment {
  id            String                    @id @default(cuid())
  userId        String                    @unique
  secretCipher  String                    // AES-GCM(secret) base64
  secretIv      String                    // 12-byte IV base64
  status        TwoFactorEnrollmentStatus @default(PENDING)
  activatedAt   DateTime?
  lastUsedAt    DateTime?
  createdAt     DateTime                  @default(now())
  updatedAt     DateTime                  @updatedAt
  user          User                      @relation(fields: [userId], references: [id])
}

model RecoveryCode {
  id        String   @id @default(cuid())
  userId    String
  codeHash  String                          // argon2(code)
  usedAt    DateTime?
  createdAt DateTime @default(now())
  user      User    @relation(fields: [userId], references: [id])
  @@index([userId])
}

model TwoFactorChallenge {
  id         String                  @id @default(cuid())
  userId     String
  kind       TwoFactorChallengeKind
  tokenHash  String                  @unique     // sha256(opaque)
  expiresAt  DateTime
  consumedAt DateTime?
  createdAt  DateTime                @default(now())
  user       User                    @relation(fields: [userId], references: [id])
  @@index([userId, kind])
}

// User additions
twoFactorEnabled Boolean @default(false)
```

## Auth flow

### Enrollment
1. `POST /auth/2fa/enroll/start` (authenticated) → creates/replaces a PENDING TotpEnrollment with a new 20-byte secret. Returns `{ otpauthUrl, secretBase32 }`. The url is what the QR code encodes.
2. `POST /auth/2fa/enroll/verify { code }` — verify a TOTP from the user's authenticator. On success: enrollment.status = ACTIVE, user.twoFactorEnabled = true, generate 10 recovery codes (`XXXX-XXXX` format, alphabet `ABCDEFGHJKMNPQRSTUVWXYZ23456789`), hash with argon2, return cleartext codes in response (one-shot, never returned again).

### Login
1. `POST /auth/login { email, password }` — verify password as today. If `user.twoFactorEnabled === false`, behave exactly as before.
2. If `twoFactorEnabled === true`, do **not** mint accessToken/refresh. Instead create a TwoFactorChallenge (kind LOGIN, 5min TTL, opaque 32-byte token sha256-hashed). Return:
   ```json
   { "mfaRequired": true, "challenge": "<opaque>" }
   ```
3. `POST /auth/2fa/verify { challenge, code }` — load challenge by sha256(challenge), reject if expired/consumed/wrong-kind. Verify `code` against TotpEnrollment (±1 step window, 30s) OR against unused RecoveryCode rows (argon2 verify, mark usedAt on hit). On success: mark challenge consumedAt, mint accessToken + refresh, return same shape `/auth/login` previously did.
4. Rate-limited: `auth.2fa-verify`, 10/60s, scope ip+user (user-scope falls through when unauth — ip alone here).

### Disable
- `POST /auth/2fa/disable { code }` — requires a fresh OTP (or recovery code). On success: enrollment.status flips to PENDING (or row deleted), user.twoFactorEnabled = false, all RecoveryCode rows for user deleted, all refreshTokens revoked (security: force re-login).

### Recovery code regenerate
- `POST /auth/2fa/recovery-codes/regenerate { code }` — requires a fresh OTP. Deletes all old RecoveryCode rows, issues 10 fresh ones, returns cleartext.

### Admin reset
- `POST /admin/users/:id/2fa/reset` — admin-only. Deletes TotpEnrollment + all RecoveryCode rows for that user, sets twoFactorEnabled = false. Audited. The user can re-enroll on next sign-in.

## Encryption-at-rest for TOTP secret

- Symmetric AES-256-GCM with a key derived from env `TWO_FACTOR_ENC_KEY` (32 random bytes, base64). One IV per row, stored alongside ciphertext. If the env key changes, existing enrollments become unreadable — admin reset is the recovery path.
- The cleartext secret is held in memory only during a single verification call; never logged.

## TOTP parameters

- Algorithm: HMAC-SHA1 (the de-facto authenticator-app standard).
- Digits: 6.
- Step: 30 seconds.
- Verification window: ±1 step (so up to 60s clock skew tolerance).
- Anti-replay: lastUsedStep stored on enrollment; reject if the verified step ≤ lastUsedStep.

## otpauth URL

`otpauth://totp/Onsective:{email}?secret={BASE32}&issuer=Onsective&algorithm=SHA1&digits=6&period=30`

Frontend renders this as a QR code via a client-side library (`qrcode` package on buyer-web only — not bundled into the API).

## Audit & abuse hooks

- AuditService.record on: enroll-activated, disable, recovery-regen, admin-reset, recovery-code-used, login-via-2fa.
- Failed `/auth/2fa/verify` is rate-limited and emits `auth.2fa.failed` event for future security alerting.

## Frontend (buyer-web only this phase)

- `/account/security` page: shows enabled/disabled state. Enable flow shows QR + manual secret, 6-digit input, then displays 10 recovery codes once. Disable flow asks for a code.
- Login page: when API returns `mfaRequired`, swap form to a 6-digit OTP input + "use recovery code instead" toggle.

## Admin

- User detail page gets a "Reset 2FA" button (already wired into existing admin user views — small addition).

## API client additions

```ts
class AuthApi {
  // existing: login, register, refresh, me, logout
  twoFactorEnrollStart(): Promise<{ otpauthUrl: string; secretBase32: string }>
  twoFactorEnrollVerify(code: string): Promise<{ recoveryCodes: string[] }>
  twoFactorVerify(challenge: string, code: string): Promise<LoginResult>
  twoFactorDisable(code: string): Promise<{ ok: true }>
  twoFactorRegenerateRecoveryCodes(code: string): Promise<{ recoveryCodes: string[] }>
}

class AdminApi {
  // existing: ...
  resetUserTwoFactor(userId: string): Promise<{ ok: true }>
}
```

`AuthApi.login` return type becomes `LoginResult | { mfaRequired: true; challenge: string }`.

## Rate limits

| Endpoint | Limit | Window | Scope |
|----------|-------|--------|-------|
| `/auth/2fa/verify` | 10 | 60s | ip+user (user falls through unauth → ip alone) |
| `/auth/2fa/enroll/start` | 5 | 3600s | user |
| `/auth/2fa/disable` | 5 | 3600s | user |
| `/auth/2fa/recovery-codes/regenerate` | 3 | 86400s | user |

## Out-of-scope follow-ons (not this phase)

- WebAuthn / passkeys.
- 2FA *required* policy (admin can force-enroll their team).
- Device trust cookie.
- Seller-web / admin-web portal-specific enrollment UI (they use the same endpoints — the buyer enrollment UI just needs duplicating into those portals).
