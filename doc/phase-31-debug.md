# Phase 31 — Two-Factor Authentication — Debug Pass

> Post-implementation walk-through. Confirms invariants, lists every entry point, and notes the deliberate limitations so future phases can lift them.

## What shipped

- **Algorithm:** RFC 6238 TOTP, HMAC-SHA1, 6 digits, 30-second step, ±1-step verification window. Hand-rolled in `services/api/src/modules/two-factor/totp.ts` — no `otplib` / `speakeasy` dependency. Constant-time string compare in the verify loop avoids timing leaks across the candidate window.
- **At-rest secret encryption:** AES-256-GCM with 12-byte IV + 16-byte auth tag stored alongside ciphertext. Key from `TWO_FACTOR_ENC_KEY` (base64 of 32 raw bytes); throws in production if unset. Dev fallback derives a deterministic key from `JWT_ACCESS_SECRET` so a dev DB stays decryptable across restarts.
- **Replay guard:** `TotpEnrollment.lastUsedStep` is monotonic. Verification refuses any step ≤ the last accepted one, so a code captured by a network observer can't be replayed within its 30-second window.
- **Recovery codes:** 10 per enrollment, format `XXXX-XXXX` using the same Crockford-ish alphabet as Phase 25 referral codes (no 0/O/1/I/L). Stored as argon2 hashes; cleartext returned exactly once at issue-time and never again. Single-use — `usedAt` set on consumption. Normalization strips non-alphabet input so users can type with or without the dash.
- **Login challenge:** when `User.twoFactorEnabled === true`, `/auth/login` returns `{ mfaRequired: true, challenge }` instead of tokens. The opaque 32-byte challenge is sha256-hashed on disk, expires in 5 minutes, and is single-use (`consumedAt` flipped on verify). Wrong kind / wrong user / expired / consumed all reject with `UnauthorizedException`.
- **Disable challenge:** internally minted by the controller before calling `verifyChallenge` — the user just submits a code; the controller mints a one-shot DISABLE challenge, consumes it inline, then proceeds with the destructive operation. Keeps the verify surface uniform.

## Invariants

1. **Two `TotpEnrollment` cardinality:** at most one row per user, enforced by `@unique` on `userId`. Restarting enrollment overwrites the secret in-place; it does not stack rows.
2. **No tokens without 2FA proof.** Once `twoFactorEnabled = true`, `/auth/login` cannot return an `AuthResponse`. Only `/auth/2fa/verify` mints tokens for those accounts.
3. **Disable is always destructive.** Disable wipes `TotpEnrollment`, all `RecoveryCode`, and **revokes every refresh token** in the same transaction. Re-enrollment is a clean slate.
4. **Admin reset is idempotent.** Calling reset on a user with no enrollment still flips `twoFactorEnabled = false` and returns `{ ok: true }`.
5. **Recovery codes survive only the active enrollment.** Disabling 2FA, admin-reset, regenerating, and re-enrolling all delete prior `RecoveryCode` rows.
6. **No recovery without active enrollment.** `verifyChallenge` short-circuits to `UnauthorizedException('Two-factor not enabled')` if a challenge exists for a user whose enrollment isn't ACTIVE — recovery codes alone never unlock an account.

## Endpoint inventory

| Method | Path | Auth | Rate limit | Notes |
|--------|------|------|------------|-------|
| POST | `/auth/login` | none | `auth.login` 10/60s ip | returns either AuthResponse or `{mfaRequired,challenge}` |
| POST | `/auth/2fa/verify` | none (challenge is the proof) | `auth.2fa-verify` 10/60s ip | mints tokens after OTP or recovery |
| GET  | `/auth/2fa/status` | bearer | — | `{enabled, enrollmentStatus, activatedAt, lastUsedAt, recoveryCodesRemaining}` |
| POST | `/auth/2fa/enroll/start` | bearer | `auth.2fa-enroll-start` 5/3600s user | returns `{otpauthUrl, secretBase32}`, replaces pending secret |
| POST | `/auth/2fa/enroll/verify` | bearer | — (single-shot, gated by start limit) | activates enrollment + returns recovery codes |
| POST | `/auth/2fa/disable` | bearer | `auth.2fa-disable` 5/3600s user | requires current OTP or recovery code |
| POST | `/auth/2fa/recovery-codes/regenerate` | bearer | `auth.2fa-recovery-regen` 3/86400s user | requires current OTP or recovery |
| POST | `/admin/users/:id/2fa/reset` | bearer + ADMIN | — (RolesGuard is the gate) | audits actor |

## Audit trail

Every state change is recorded via `AuditService.record`:

- `two_factor.enroll.start` — every time a PENDING secret is created or rotated.
- `two_factor.enroll.activated` — first successful TOTP verify.
- `two_factor.verify.login` — login-challenge consumed via OTP.
- `two_factor.verify.disable` — disable-challenge consumed via OTP.
- `two_factor.verify.recovery_code` — recovery code consumed (either kind).
- `two_factor.disabled` — disable completed.
- `two_factor.recovery_codes.regenerated` — fresh batch issued.
- `two_factor.admin_reset` — admin-driven nuke.

All include actor user ID, IP, and user-agent.

## Manual test list

1. **Happy enroll → login.** `/account/security` → set up 2FA → enter authenticator code → save recovery codes → sign out → sign in → enter OTP → land in.
2. **Login with recovery code.** Sign in with one of the 10 codes → success, code marked used. Try the same code again → fails. Status shows `recoveryCodesRemaining: 9`.
3. **Recovery-code regenerate.** From `/account/security`, regen with current OTP → 10 fresh codes returned. Old codes immediately stop working.
4. **Disable.** From `/account/security`, disable with current OTP → all tokens revoked (next request 401s) → re-login with password alone.
5. **Wrong code rate-limit.** 11 bad `/auth/2fa/verify` attempts from one IP → 429 with `Retry-After`.
6. **Expired challenge.** Sleep > 5 min after login, submit code → `Challenge expired`.
7. **Reused challenge.** Verify successfully, replay the same challenge → `Challenge already used`.
8. **Admin reset.** From `/security` page in admin-web, paste a buyer ID → reset → that buyer signs in with password only, refresh tokens revoked.
9. **Step replay defense.** Submit a code during the current 30s window twice → second submission rejected by `lastUsedStep` even though it's still the live code.
10. **Cross-portal 2FA.** Enable 2FA as buyer → switch role → admin/seller login flows correctly handle the `mfaRequired` branch.
11. **Encryption robustness.** Tamper `secretCipher` in DB (flip a byte) → next verify call decryptSecret throws `Unsupported state`; user is effectively locked out. Admin reset clears.
12. **Mobile fallback.** Existing iOS/Android app gets a clear error directing the user to the web until mobile parity ships.

## Decisions worth highlighting

- **No bundled QR library.** Buyer-web displays the secret base32 + the otpauth URL for manual entry. The QR rendering is a small follow-on we can do without disturbing the security surface — adding a `qrcode` dep is a buyer-web concern, not a security concern. Authenticator apps universally support manual entry.
- **No device-trust cookie.** Every login asks for the OTP. Devices can be added later as a separate phase if friction becomes a real concern, but the threat model right now is credential-stuffing → adding a "remember this device" path would create a fresh path of trust that needs its own revocation surface.
- **No SMS / email OTP.** Outside the threat-model improvement zone — SMS in particular has been deprecated for high-assurance MFA by NIST since 2016.
- **No forced 2FA policy.** Admins can self-enable but can't (yet) force their team to enroll. That's a one-day Phase 32+ addition: a `User.twoFactorRequired` flag + a redirect on `/auth/me` when ACTIVE enrollment is missing.
- **Disable revokes all refresh tokens.** Strong default — if 2FA goes off, every active session has to be re-authenticated. This is the right tradeoff for an account-recovery / under-attack scenario.
- **Verify endpoint is `noAuth: true`.** It uses the challenge token as its own auth proof. Bearer is not required because the user is mid-authentication.

## Limitations / follow-ons

- **No QR code rendering in the UI.** Users currently type the secret manually. Trivial follow-on (~30-line addition with `qrcode` npm package).
- **Mobile app doesn't yet verify 2FA.** It throws a friendly error pointing the user to the web. Wiring the verify flow into the RN screens is a Phase-32+ deliverable.
- **No forced enrollment policy.** Tracked.
- **No WebAuthn / passkeys.** Separate, larger phase — out of scope here.
- **Admin reset has no double-confirmation UI.** A second-admin approval workflow would be appropriate at scale; deferred.
- **No bulk admin operations.** Admin reset is per-user only.
