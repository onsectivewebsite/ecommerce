# Phase 33 — WebAuthn / Passkeys — Debug Pass

> Post-build walk-through of what shipped, the invariants that hold, every endpoint, and the deferred follow-ons.

## What shipped

- **Hand-rolled CBOR decoder** for the WebAuthn-specific subset (unsigned/negative ints, byte strings, text strings, arrays, maps). No third-party CBOR dep; ~120 lines.
- **COSE_Key parser → Node KeyObject** for the three algorithms WebAuthn deploys in 2025+: ES256 (-7), RS256 (-257), EdDSA (-8). Hand-builds SubjectPublicKeyInfo DER prefixes per algorithm and lets Node's `createPublicKey()` parse the rest. No JWK round-trip.
- **authData parser** that reads the rpIdHash, flags, signCount, AAGUID, credentialId, and trailing COSE_Key out of the binary blob the authenticator emits.
- **Registration**: `/auth/webauthn/register/options` → `navigator.credentials.create()` → `/auth/webauthn/register/verify`. The verify step checks origin, RP-ID hash, user-presence flag, attestation-object well-formedness, and stores the COSE public key for later assertions. `twoFactorEnabled` flips to true at first enrollment.
- **Login (passwordless)**: `/auth/webauthn/login/options { email? }` → `navigator.credentials.get()` → `/auth/webauthn/login/verify`. Verifies signature against stored COSE key. With no `email` the server returns an empty `allowCredentials` so the browser shows its native passkey picker (discoverable credentials).
- **Passkey as second factor**: `/auth/2fa/verify-passkey` takes both the LOGIN challenge from `/auth/login` and a fresh WebAuthn challenge from `/auth/webauthn/login/options`. Validates the assertion, then consumes the LOGIN challenge for the same user.
- **Counter-based clone detection.** Stored `signCount` must strictly increase per assertion. Apple-style "always-zero" authenticators get a special pass when both values are zero.
- **Discoverable-flow anchor user.** Challenge rows have a non-null `userId` FK; when no email is provided up-front, we anchor the challenge to a system user (`u_system_webauthn_anchor`, status `SUSPENDED`, blank password) so the FK is satisfied without leaking real-user info. Login refuses to authenticate as this user (Phase 26 logic rejects empty `passwordHash`).
- **Frontend**: `PasskeysCard` on `/account/security`, "Sign in with a passkey" on the login page, "Use a passkey instead" on the 2FA challenge page, admin reset action on `/security`. Helpers in `lib/webauthn.ts` handle base64url ↔ ArrayBuffer plumbing.

## Invariants

1. **One challenge, one ceremony.** Each ceremony (register, login, 2FA-verify) consumes the challenge row at the start of verify. Replay attempts get `Challenge already used`.
2. **Origin and RP-ID are checked twice.** Once via `clientDataJSON.origin` against the env allow-list, once via `sha256(RP_ID)` against `authData.rpIdHash`. A mismatch on either rejects.
3. **Counter must strictly increase** (or both endpoints stay at 0 — the Apple platform pass).
4. **Algorithm whitelist.** `pubKeyCredParams` advertises only `-7 / -257 / -8`. The COSE parser refuses anything else. Browsers won't enroll an authenticator that can't satisfy at least one of these.
5. **Credential IDs are globally unique.** `credentialId @unique` prevents the same authenticator from being enrolled twice across any user.
6. **Removing a passkey doesn't auto-flip `twoFactorEnabled`.** A user who deletes their last passkey but kept TOTP is still 2FA-on. A user who deletes their last passkey and never enrolled TOTP becomes 2FA-off automatically only if you manually flip it — by design we leave the flag where it is and let the security UI surface the gap.
7. **Passwordless login bypasses password but not 2FA.** The passkey assertion *is* the 2FA — possession (the device) + user-verification (Touch ID / PIN) covers both factors.

## Endpoint inventory

| Method | Path | Auth | Rate limit | Notes |
|--------|------|------|------------|-------|
| POST | `/auth/webauthn/register/options` | bearer | `auth.webauthn-register-options` 5/3600s user | returns CreationOptions JSON + opaque challenge |
| POST | `/auth/webauthn/register/verify` | bearer | — | activates credential |
| GET  | `/auth/webauthn/credentials` | bearer | — | list mine |
| POST | `/auth/webauthn/credentials/:id/remove` | bearer | — | delete (POST not DELETE — sidesteps Next/CORS oddities) |
| POST | `/auth/webauthn/login/options` | none | `auth.webauthn-login-options` 30/60s ip | optional email triggers allowCredentials |
| POST | `/auth/webauthn/login/verify` | none | `auth.webauthn-login-verify` 10/60s ip | mints tokens |
| POST | `/auth/2fa/verify-passkey` | none | `auth.2fa-verify` 10/60s ip | exchanges loginChallenge + assertion → tokens |
| POST | `/admin/users/:id/webauthn/reset` | bearer + ADMIN | — | nukes all credentials |

## Schema additions

- `WebAuthnCredential` (per credential per user; credentialId @unique)
- New `WebAuthnCredentialTransport` enum
- Two new values in `TwoFactorChallengeKind`: `WEBAUTHN_REGISTER`, `WEBAUTHN_LOGIN`
- `User.webauthnCredentials` back-relation

## Audit trail

`AuditService.record` writes for every state change:
- `webauthn.credential.registered`
- `webauthn.credential.removed`
- `webauthn.assertion.verified`
- `webauthn.admin_reset`

All include actor, IP, user-agent.

## Manual test list

1. **First passkey on Mac.** Sign in → `/account/security` → Passkeys → Add → Touch ID prompt → confirm. Credential appears with "internal" transport.
2. **Sign in with passkey (passwordless).** Sign out → login page → "Sign in with a passkey" → platform picker → success → land on next URL.
3. **Passkey as second factor.** Enable both TOTP and a passkey. Sign in with password → 2FA page → "Use a passkey instead" → success.
4. **Counter replay defense.** Tamper the stored `signCount` to a value above what the authenticator emits → next assertion fails with `Authenticator counter regression`.
5. **Duplicate enrollment.** Try to enroll the same authenticator twice → 409 `This passkey is already registered`.
6. **Wrong origin.** Submit a verify request with `clientDataJSON.origin = "https://attacker.com"` → 401 `Bad origin`.
7. **RP-ID mismatch.** Manually feed an authData buffer from a different domain → 401 `RP ID hash mismatch`.
8. **Algorithm rejection.** Authenticator that only offers `Ed448` (-9) → browser returns no credential because the option list doesn't include it; if forced, the COSE parser rejects.
9. **Cross-portal.** Enroll a passkey via buyer-web → sign in to seller-web with the same email → password flow returns `mfaRequired` → fall back to TOTP (seller-web has no passkey UI yet, but the API would accept the assertion if the seller portal added it).
10. **Admin reset.** Admin nukes a user's passkeys → list returns empty → user must re-enroll. Audit log shows `webauthn.admin_reset` against the admin's userId.
11. **Discoverable-flow without email.** Login page → "Sign in with a passkey" → platform shows account picker with all available passkeys → select buyer-web account → success.

## Decisions worth highlighting

- **Hand-rolled CBOR over `cbor` package.** Auth-path code shouldn't import a 30kB lib with 50 transitive deps. The WebAuthn CBOR subset is tiny and our decoder is ~120 lines with no DoS surface (rejects indefinite-length, rejects tags, rejects unsupported types).
- **No JWK round-trip.** Going COSE → JWK → KeyObject costs nothing operationally but adds a path where a future Node version could change JWK semantics. Going COSE → DER → KeyObject is constant and immutable per algorithm.
- **`attestation: 'none'`** by policy. We're not yet validating "this is a specific YubiKey model" — that's an enterprise-attestation feature for regulated environments. We still verify the signature against the credential's public key on every assertion, so the security properties are intact.
- **Opaque challenge token + sha256-derived bytes.** Saves a column. The opaque is 32 random bytes; sha256 of it is also indistinguishable from random. We could store both, but there's no security gain.
- **`POST` for remove instead of `DELETE`.** Matches the existing API style (Phase 31's challenge consumption is also POST-based) and avoids any preflight/CORS surprises in client code that doesn't always re-send `Origin` on DELETE.
- **Discoverable-flow anchor user.** Foreign-key constraints don't let us NULL the userId on a TwoFactorChallenge row when we don't know the user yet. Anchoring to a deterministic, suspended system user with no password keeps the schema honest. The user row is created lazily on first call.
- **Login refuses to authenticate as the anchor user** because Phase 26's `AuthService.validate` already rejects accounts with an empty `passwordHash`. So the anchor user is invisible to anyone trying to abuse it.

## Limitations / follow-ons

- **Strong attestation.** Enterprise-attestation policy (require a specific AAGUID, e.g. only allow corporate YubiKeys) is not implemented. We capture the AAGUID at registration and could filter against it in a future phase.
- **Conditional UI / autofill.** `navigator.credentials.get({ mediation: 'conditional' })` surfaces passkeys in the email field of the regular login form. We use explicit buttons today; conditional UI is a polish follow-on.
- **Seller-web / admin-web / shipping-web don't yet have enrollment UI.** They use the same API, so the login challenge already accepts passkey-second-factor across portals (the buyer-web flow handles it). Adding the `PasskeysCard` to each portal is a small copy-paste away.
- **Mobile (Expo / React Native).** The native passkey APIs (iOS Authentication Services, Android Credential Manager) require platform-specific bridges. Out of scope for this phase; the existing mobile error message points users to the web.
- **Recovery-when-no-factors-left.** If a user has only passkeys, loses all devices, and never enrolled TOTP, the admin-reset path is the only recovery. A future phase could add an email-verified password reset that also wipes 2FA — gated behind extra friction.
- **No "trusted device" cookie** — every login asks for the second factor. Same trade-off we made in Phase 31.
