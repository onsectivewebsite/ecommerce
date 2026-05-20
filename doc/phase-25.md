# Phase 25 — Buyer Referrals

Date opened: 2026-05-18
Predecessor: Phase 24 (Saved-Card Checkout & Plus Ops)

## 1. Why this phase

Phase 22 shipped a points ledger as the existing growth currency.
Phase 23 and 24 finished the Plus product. What the platform
doesn't yet have is a way for buyers to bring other buyers in.

Phase 25 ships referrals as the simplest possible "bring a
friend" loop:

1. Every signed-in buyer gets a personal referral code on first
   visit to `/account/referrals`.
2. Sharing the URL `https://app/?ref=ABCDEFGH` deep-links a new
   visitor into the signup flow with the code captured.
3. When the invitee places their **first paid order**, both
   inviter and invitee receive a points award (default 500 each,
   configurable).
4. The points land in the existing Phase 22 points account and
   the buyer can redeem to wallet via the existing flow.

It's deliberately one feature, one reward currency, one redemption
event per invitee. The anti-fraud rules are conservative but
finite: same user, same default shipping address, same signup IP,
or more than 25 redemptions in a rolling 30-day window all reject.

## 2. Scope (in)

### 2.1 ReferralCode
```
ReferralCode {
  id, code @unique, userId @unique,
  status: ReferralCodeStatus,         // ACTIVE | DISABLED
  totalRedemptions Int @default(0),
  createdAt, updatedAt
}
```
- Code is 8 chars from an unambiguous alphabet
  (`ABCDEFGHJKMNPQRSTUVWXYZ23456789` — drops `I`, `L`, `O`, `0`,
  `1`).
- Generated lazily on first read so accounts that never visit the
  page don't have spurious rows.
- ADMIN can DISABLE a code via `POST /admin/referrals/:code/disable`
  if abuse is confirmed. DISABLED codes still resolve to the user
  for the abuse log but write no redemption.

### 2.2 ReferralRedemption
```
ReferralRedemption {
  id,
  codeId,
  inviterUserId,
  inviteeUserId @unique,             // each user can redeem at most once
  inviteeFirstOrderId @unique,       // each order can fund at most one redemption
  inviterPointsAwarded Int,
  inviteePointsAwarded Int,
  signupIp?, signupUserAgent?,       // captured at signup for forensics
  createdAt
}
```
- Both unique constraints enforce the "one redemption per
  invitee, one per order" invariant at the database layer.
- Listener catches P2002 violations as idempotent no-ops.

### 2.3 ReferralAbuseEvent
```
ReferralAbuseEvent {
  id,
  attemptedCode,
  attemptedUserId?,
  reason: ReferralRedemptionRejectionReason,  // SELF_REDEMPTION | SAME_ADDRESS | SAME_IP | CODE_DISABLED | LIMIT_REACHED | NO_SUCH_CODE
  ip?, userAgent?,
  createdAt
}
```
Audit log of rejected attempts. Admin can review.

### 2.4 ReferralsService
- `getOrCreateForUser(userId)` — returns or creates the user's
  code with collision retry.
- `getByCode(code)` — case-insensitive lookup; null if missing or
  DISABLED.
- `recordSignupCapture(inviteeUserId, code, ip?, userAgent?)` —
  validates the code exists, runs SELF_REDEMPTION + SAME_IP
  pre-checks, stamps `User.referralCodeUsed` + `signupIp` on the
  invitee user row.
- `processFirstPaidOrder(inviteeUserId, orderId)` — called by
  the listener. Resolves the captured code, runs full anti-fraud
  set (SELF_REDEMPTION, SAME_ADDRESS, SAME_IP at signup time,
  CODE_DISABLED, LIMIT_REACHED — 25/30d), and on pass writes the
  ReferralRedemption row + awards points to both sides via
  PointsService with `referenceKey=referral:<inviteeUserId>` so a
  duplicate processing call is a no-op.
- `myRedemptions(userId)` — returns the redemptions the user has
  earned as inviter, with invitee-name display.
- `disable(adminUserId, code)` — flips status, audits.

### 2.5 Signup capture
- `AuthService.signup` accepts optional `referralCode` field.
- Signup populates `User.referralCodeUsed` + `User.signupIp` at
  account-create time.
- The buyer-web signup form reads `?ref=` from the URL on mount
  and posts it through.

### 2.6 Payout listener
- `ReferralPayoutListener` subscribes to `order.paid` and calls
  `processFirstPaidOrder`. The service itself does the "is-first-
  paid-order" check by querying for any other PAID order for the
  invitee (excluding the current one).

### 2.7 Buyer page
- `/account/referrals` shows: the code, a "Copy share link"
  button, the reward amounts (rendered from the env values), a
  card with the totals (`X friends joined · Y pts earned`), and
  a list of recent redemptions (invitee first name + redemption
  date + points awarded).

### 2.8 Admin page
- `/admin/referrals` shows:
  - top 20 inviters by total redemptions in the last 30 days,
  - the most recent 100 `ReferralAbuseEvent` rows,
  - a search box to look up a code and a button to disable it.

## 3. Scope (out)

- Tiered rewards (e.g., extra bonus at 10 redemptions).
- Per-invitee bonus boost for Plus members.
- Wallet-credit option for the reward — keeping it points-only so
  buyers go through the existing wallet redemption flow.
- Email "your friend just joined!" notifications — the existing
  `/account/referrals` activity list is enough for v1. The
  notifications module can wire a category later.
- Referral leaderboards.
- Marketplace-wide referral campaigns (admin-issued blanket codes).
  Phase 25 is buyer-to-buyer only.

## 4. Architectural decisions made up front

### 4.1 Points, not wallet
We award points instead of direct wallet credit because:
- the points ledger is already idempotent on `referenceKey`,
- buyers already have a mental model for points,
- it forces a second deliberate action (redeem) which gives us a
  natural anti-bot speed bump.

### 4.2 Redemption fires on first PAID, not first order
A buyer can place an order and never pay it (cart abandonment,
declined card). We only count the reward once the order captures.
Matches how Phase 22 awards purchase points.

### 4.3 Anti-fraud at the listener, not at signup
Signup captures the code with cheap checks (self-referral, same
IP). The expensive checks (same default shipping address, 30-day
limit) run at redemption time when more buyer state exists.

### 4.4 SAME_IP is checked against the inviter's signup IP, not
their current IP
We compare the invitee's signup IP to the inviter's signup IP.
NAT collisions exist; we tolerate them by also requiring
SAME_ADDRESS to converge on the same household before
rejecting. (Either-or rejection is too aggressive.)

Actually, on reflection we use either-or rejection — same IP
alone is a reject. Real households where a parent refers a child
to Onsective will be a rare false positive; the platform can
manually re-issue points for those cases. Keeping the rule tight
is the right default for a launch.

### 4.5 8-char code, unambiguous alphabet
8 characters from a 31-char alphabet gives ~9×10^11 codes —
plenty for the lifetime of the platform. The dropped chars
(`I`, `L`, `O`, `0`, `1`) make codes copy-paste-resistant.

### 4.6 ReferralCode is one-per-user
A user has at most one active code at a time. Disabling and
re-enabling produces a new code (history preserved on the
ReferralAbuseEvent rows).

### 4.7 Listener is independent of any other order.paid handler
Same pattern as Phase 22 LoyaltyListener and Phase 20
SustainabilityListener: a try/catch wraps the whole thing, errors
log but don't propagate. The order flow is unaffected by a
referral processing failure.

## 5. Acceptance criteria

- New buyer visits `/account/referrals` for the first time → row
  created, 8-char code shown, share URL copyable.
- Anonymous visitor lands at `/?ref=ABCDEFGH` → signup form
  reads the code and passes it on submit → new User row has
  `referralCodeUsed=ABCDEFGH`, `signupIp` populated.
- Invitee places their first paid order →
  `ReferralRedemption` row written, both users see +500 pts in
  their statement. Re-emit `order.paid` for that same order →
  no second redemption row, no double points (referenceKey
  unique catches it).
- Invitee places a second order → no second redemption (the
  `inviteeUserId` unique catches it).
- Buyer A's code used by Buyer A on their own first order →
  rejected with `SELF_REDEMPTION`, `ReferralAbuseEvent` row
  written, no points.
- Buyer A's code captured by Buyer B who has the same default
  shipping address (line1 + postal) → rejected with
  `SAME_ADDRESS`.
- Buyer A's code captured by Buyer B who signed up from Buyer
  A's IP → rejected with `SAME_IP`.
- Buyer A racks up 25 successful redemptions in 30 days; the
  26th rejects with `LIMIT_REACHED`.
- Admin hits `POST /admin/referrals/:code/disable` → code
  flips to DISABLED, future captures reject with
  `CODE_DISABLED`.
- `/admin/referrals` shows top inviters + recent abuse events.
- `doc/phase-25-debug.md` captures decisions + limitations.
