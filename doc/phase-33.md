# Phase 33 — WebAuthn / Passkeys

> Adds modern, phishing-resistant authentication on top of Phase 31's TOTP. A user can enroll one or more passkeys (platform — Touch ID / Face ID / Windows Hello — or roaming, like a YubiKey). Once enrolled, the passkey can be presented in place of TOTP as a strong second factor, OR used for passwordless sign-in. No third-party libs; we hand-roll the verification using Node's WebCrypto.

## Goals

1. **Enroll up to N passkeys per user.** Each gets a human-readable label ("MacBook Touch ID", "iPhone", "Backup YubiKey").
2. **Second-factor parity with TOTP.** A user with passkeys gets the same `mfaRequired` login response, but the verify path accepts a WebAuthn assertion instead of a TOTP code.
3. **Passwordless sign-in option.** Users with at least one passkey can hit "Sign in with passkey" on the login page and skip the password step entirely (browser uses the platform credential UI). Same outcome — full tokens issued.
4. **Counter-based clone detection.** WebAuthn authenticators include a counter that must increase per use. We reject any assertion whose counter ≤ stored value.
5. **Admin reset.** Admin can nuke all passkeys for a user (lock-out recovery, lost device).

## Non-Goals

- **Attestation verification** beyond the `none` format. Most consumer passkeys (Apple/Google/Microsoft platform authenticators) emit `packed` or `none` attestations; we accept the response as long as the signature verifies against the credential public key. Enterprise attestation policy (verify it's a specific YubiKey model) is a follow-on.
- **Conditional UI / autofill.** Browsers expose `mediation: 'conditional'` to surface passkeys in the email field. Out of scope for v1; we provide an explicit "Sign in with passkey" button.
- **Multi-factor passkey policy.** A passkey alone fully authenticates the user (because it proves possession + user-verification via biometric/PIN). No requirement to combine with password.
- **Cross-portal passkey UI.** Seller-web / admin-web / shipping-web inherit the API but don't yet ship the enrollment UI in this phase — they can still sign in if a user has passkeys enrolled via buyer-web.

## Schema

```prisma
enum WebAuthnCredentialTransport { USB, NFC, BLE, INTERNAL, HYBRID }

model WebAuthnCredential {
  id             String                          @id
  userId         String
  /// base64url credentialId (the authenticator-generated handle).
  credentialId   String                          @unique
  /// COSE-format public key (CBOR-encoded), base64url. We re-parse on every verify
  /// — small, deterministic, and avoids JWK conversion drift.
  publicKey      String
  /// COSE algorithm identifier: -7 ES256, -257 RS256, -8 EdDSA.
  algorithm      Int
  /// Monotonic counter from the authenticator. Reject any assertion that
  /// doesn't strictly increase this. Some authenticators always emit 0
  /// (e.g. Apple platform passkeys); we allow that — see signCounter check.
  signCount      Int                             @default(0)
  /// User-friendly label for /account/security display.
  label          String
  /// Optional transport hints from registration ("usb", "internal", "hybrid").
  transports     WebAuthnCredentialTransport[]
  /// Indicates this is a discoverable credential ("passkey"); set by
  /// registration when authenticator reports rk=true.
  discoverable   Boolean                         @default(false)
  /// Indicates user verification was performed at registration (Touch ID etc).
  userVerified   Boolean                         @default(false)
  /// AAGUID of the authenticator (16 bytes hex). Useful for vendor diagnostics.
  aaguid         String?
  lastUsedAt     DateTime?
  createdAt      DateTime                        @default(now())
  updatedAt      DateTime                        @updatedAt
  user           User                            @relation(fields: [userId], references: [id], onDelete: Cascade)
  @@index([userId])
}
```

We reuse the existing `TwoFactorChallenge` model from Phase 31 for the WebAuthn challenge. Two new kinds are added to the enum: `WEBAUTHN_REGISTER` and `WEBAUTHN_LOGIN`. The opaque token field stores the raw challenge bytes (base64url), sha256-hashed for storage.

## Flow

### Registration (authenticated user)

```
POST /auth/webauthn/register/options { label }
  → returns:
    {
      publicKey: PublicKeyCredentialCreationOptions  // the spec JSON shape
      challenge: <opaqueToken>                       // server-side handle
    }
```

The client passes the `publicKey` payload to `navigator.credentials.create()`. The browser returns a `PublicKeyCredential` whose `response` includes:
- `clientDataJSON`
- `attestationObject` (base64url'd ArrayBuffer)
- `transports` (array of strings)

```
POST /auth/webauthn/register/verify {
  challenge,                  // opaque server token
  credentialId,               // from credential.id (base64url)
  clientDataJSON,             // base64url
  attestationObject,          // base64url
  transports?,                // ["internal", "hybrid"]
  label                       // user-friendly name
}
  → returns: { id, label, createdAt }
```

Server verifies:
1. Challenge token exists, is `WEBAUTHN_REGISTER` kind, not consumed, not expired.
2. `clientDataJSON.type === "webauthn.create"`.
3. `clientDataJSON.challenge` (base64url) matches the raw bytes we stashed.
4. `clientDataJSON.origin` is one of our allowed origins.
5. Parse `attestationObject` CBOR → `{ fmt, authData, attStmt }`.
6. Parse authData → flags + counter + AAGUID + credentialId + COSE publicKey.
7. RP-ID hash in authData matches `sha256(RP_ID)`.
8. User-presence bit is set. User-verified bit is captured (not required for v1).
9. credentialId is not already registered to any user.
10. Store credential with COSE public key + initial counter.

### Login (no password — "Sign in with passkey")

```
POST /auth/webauthn/login/options { email? }
  → returns:
    {
      publicKey: PublicKeyCredentialRequestOptions
      challenge: <opaqueToken>
    }
```

If `email` is provided, we look up the user's credentialIds and return them as `allowCredentials`. If omitted, we return an empty `allowCredentials` list so the browser uses the platform's credential picker (discoverable credential flow).

```
POST /auth/webauthn/login/verify {
  challenge,
  credentialId,
  clientDataJSON,
  authenticatorData,
  signature,
  userHandle?                 // for discoverable creds, base64url of userId
}
  → returns: AuthResponse  (same shape as /auth/login)
```

Server verifies:
1. Challenge token exists, `WEBAUTHN_LOGIN` kind, not consumed, not expired.
2. Look up credential by `credentialId`.
3. `clientDataJSON.type === "webauthn.get"`, challenge matches, origin matches.
4. RP-ID hash in authenticatorData matches.
5. User-presence bit set.
6. Counter strictly greater than stored (or both 0 — special case for Apple).
7. Hash clientDataJSON, prepend authenticatorData, verify signature against stored public key.
8. If user has 2FA enabled (TOTP or passkeys), passkey assertion satisfies the second factor — mint tokens directly.
9. Update credential counter + lastUsedAt.

### Login (password-first, passkey replaces TOTP)

Same as Phase 31 password login — server returns `mfaRequired: true, challenge`. Frontend offers two paths:
- "Use authenticator code" (existing TOTP)
- "Use a passkey instead"

The passkey path calls `POST /auth/2fa/verify-passkey { challenge, credentialId, clientDataJSON, authenticatorData, signature }`. Server verifies the assertion (same as login/verify), then consumes the original `LOGIN`-kind challenge and mints tokens.

### Remove a passkey

```
DELETE /auth/webauthn/credentials/:id
```

Requires bearer JWT. We don't ask for a TOTP because the user is already authenticated; deleting one passkey while authenticated is a normal account-management action. If they delete the last one and have no TOTP, `twoFactorEnabled` doesn't change — passkey-only is a valid 2FA state.

### Admin reset

```
POST /admin/users/:id/webauthn/reset
```

Nukes all credentials for the user. Audited.

## Algorithm support

We support the three modern WebAuthn algorithms; the COSE alg values are:
- `-7` (ES256, ECDSA-P256-SHA256) — Apple, Google, most YubiKeys.
- `-257` (RS256, RSA-PKCS1v15-SHA256) — older Windows Hello, some YubiKeys.
- `-8` (EdDSA, Ed25519) — newer authenticators.

Verification routes through Node's `crypto.verify()` after converting the COSE key to a SubjectPublicKeyInfo DER. We hand-roll the conversion for ES256/RS256 (small, deterministic) and use Node's built-in Ed25519 verification for EdDSA.

## RP-ID and origin policy

Read from env:
- `WEBAUTHN_RP_ID` — e.g. `onsective.com` in production, `localhost` in dev.
- `WEBAUTHN_RP_NAME` — display name shown in browser prompts.
- `WEBAUTHN_ORIGINS` — comma-separated list of allowed origins (`https://onsective.com,https://www.onsective.com,http://localhost:3000`).

Origins are checked literally; RP-ID is checked via sha256.

## Frontend (buyer-web)

- `/account/security` gets a "Passkeys" card next to the existing TOTP card.
  - List of enrolled credentials with label, created date, last used.
  - "Add a passkey" button → calls `register/options` → `navigator.credentials.create()` → `register/verify`.
  - Each row has a "Remove" button.
- Login page:
  - "Sign in with a passkey" link below the password form → empty-email passkey login (discoverable credentials, browser shows native picker).
- Login-with-2FA page (Phase 31's challenge step):
  - Add a "Use a passkey instead" button below the OTP input.

## API client additions

```ts
class AuthApi {
  // existing
  webauthnRegisterOptions(label: string): Promise<{...}>
  webauthnRegisterVerify(body: {...}): Promise<{ id, label, createdAt }>
  webauthnLoginOptions(email?: string): Promise<{...}>
  webauthnLoginVerify(body: {...}): Promise<AuthResponse>
  webauthnVerifyChallenge(challenge: string, body: {...}): Promise<AuthResponse>
  webauthnCredentials(): Promise<WebAuthnCredentialRow[]>
  webauthnRemoveCredential(id: string): Promise<{ ok: true }>
}

class AdminApi {
  resetUserWebauthn(userId: string): Promise<{ ok: true }>
}
```

## Rate limits

| Endpoint | Limit | Window | Scope |
|----------|-------|--------|-------|
| `/auth/webauthn/login/options` | 30 | 60s | ip |
| `/auth/webauthn/login/verify` | 10 | 60s | ip |
| `/auth/webauthn/register/options` | 5 | 3600s | user |

## Out-of-scope follow-ons

- Strong attestation policy (require specific AAGUIDs).
- Conditional UI (autofill passkeys in email field).
- Passkey enrollment UI on seller-web / admin-web (uses the same API).
- Backup / recovery scheme for users who lose all passkeys (today: admin reset OR fallback to TOTP if also enrolled OR password reset if neither — the latter is being designed in Phase 34 candidate "Account Recovery").
- WebAuthn for seller / admin step-up actions (high-value transactions).
