# Phase 25 — Debug Pass

Companion to `phase-25.md`. Decisions made, seams to watch, what to
test before merging.

## 1. The invariants Phase 25 preserves

1. **One redemption per invitee.** `ReferralRedemption.inviteeUserId`
   is `@unique`. The DB will reject a second redemption for the
   same buyer even if a race lets two processors get past the
   service-level check.
2. **One redemption per order.** `ReferralRedemption.inviteeFirstOrderId`
   is also `@unique` so a re-delivered `order.paid` event can't
   double-award.
3. **Idempotent points award.** Each payout calls
   `PointsService.applyDelta` with a `referenceKey` of
   `referral_{inviter|invitee}:<inviteeUserId>`. Repeat calls hit
   the existing unique on `PointsTransaction.referenceKey` and
   no-op.
4. **Anti-fraud rejections never break the order.** The listener
   wraps the entire payout call in try/catch. Any rejection writes
   a `ReferralAbuseEvent` row and returns silently — the buyer's
   order is unaffected.
5. **Code reuse is impossible.** A user has at most one
   `ReferralCode` (unique on `userId`); a code disabled by admin
   cannot be replaced — disabled is permanent for that user.

## 2. Non-obvious decisions

### 2.1 Lazy code creation
A user only gets a row in `ReferralCode` when they first call
`getOrCreateForUser` (i.e., visit `/account/referrals` or the API
hits `/referrals/me`). We don't create rows at signup because the
vast majority of buyers will never share their code; backfilling
on demand keeps the table small.

### 2.2 Code lives on the User row at signup as a plain string
We stamp `User.referralCodeUsed` as a string column rather than a
foreign key. Two reasons: (a) the inviter might not exist on the
platform yet (a buyer could be invited by a future signed-up
account; in practice not in our flow but the model leaves it
open), and (b) it lets us record `NO_SUCH_CODE` abuse events
where the code points to nothing.

### 2.3 First-paid-order detection by query, not flag
We don't add an `inviteeRedemptionStatus` enum on User. Instead,
the service queries for any other PAID order for the invitee and
short-circuits if one exists. The query is O(1) on the order
index and the cost is fine because it only runs on order.paid.

### 2.4 SAME_IP is a hard reject
We compare invitee's signup IP to inviter's signup IP. If they
match, reject. Real-world NAT collisions exist (parent + child
on the same home router) and will be false positives. We accept
that trade-off; the alternative (and-with-same-address) is too
permissive given that a determined abuser can easily change one
of the two signals. Admin can re-issue points manually if a
legitimate household appeal comes in.

### 2.5 SAME_ADDRESS check is line1 + postal, case-insensitive
We don't compare full address objects because users format city
and state differently. line1 + postal is the cheapest reliable
fingerprint of "lives at the same place". Both are normalized
(`trim().toLowerCase()` on line1, `trim()` on postal).

### 2.6 30-day rolling cap
`LOYALTY_REFERRAL_LIMIT_30D` defaults to 25. A buyer who genuinely
brings in lots of friends will hit the cap; the rejection writes
to abuse log so admin can spot a legit super-referrer and reach
out (e.g., creator with a real audience). Tightening the cap is
cheaper than recovering from a credit-card fraud ring.

### 2.7 Both sides earn points, not asymmetric
The default `LOYALTY_REFERRAL_INVITER_POINTS` and
`LOYALTY_REFERRAL_INVITEE_POINTS` are both 500. Asymmetric
rewards (e.g., inviter 1000 / invitee 250) are a common pattern;
we kept them equal to avoid the gameability of "the inviter gets
much more, so let me invite my second account." If marketing
wants asymmetry later, just set the envs.

### 2.8 Code alphabet drops ambiguous chars
8 chars from `ABCDEFGHJKMNPQRSTUVWXYZ23456789` (31 chars, no
`I/L/O/0/1`) gives ~9.3×10^11 codes. Visually unambiguous when
shared verbally or scanned via photo.

### 2.9 EARN_BONUS kind, not a new enum value
Phase 22's `PointsTransactionKind.EARN_BONUS` was the catch-all
slot. Adding `EARN_REFERRAL` would force a schema migration for
a categorization that's already discoverable via the `reason`
string. We used the existing slot.

### 2.10 Disabled is permanent
There is no admin `enable` endpoint. If we ever need one we'll
add it; for now, disabling is a one-way action specifically for
abuse cases.

## 3. Things to test end-to-end

- Sign in as Buyer A → hit `/account/referrals` → row created,
  8-char code shown. Re-visit → same code.
- Open `/register?ref=<A's code>` as a new visitor → form shows
  the "joining with code" callout. Submit → User row created
  with `referralCodeUsed=<code>` and `signupIp` populated.
- Sign in as the new buyer, place a paid order → after capture,
  `ReferralRedemption` row written; both users' points statements
  show +500 each with `EARN_BONUS` kind. `ReferralCode.totalRedemptions`
  is incremented to 1.
- Re-emit `order.paid` for the same order → no second
  redemption (DB unique catches it), no second points award
  (referenceKey unique catches it).
- New invitee places a SECOND paid order → no new redemption
  (inviteeUserId already redeemed).
- Buyer A signs up with their own code (`referralCodeUsed=A's
  code`) on a separate account, places an order → rejected
  `SELF_REDEMPTION`, abuse event written, no points.
- Two buyers sharing the same default shipping address (line1
  + postal) → second redemption rejected `SAME_ADDRESS`.
- Two buyers with the same `signupIp` → rejected `SAME_IP`.
- Set `LOYALTY_REFERRAL_LIMIT_30D=2`, run three successful
  redemptions → first two pass, third rejects `LIMIT_REACHED`.
- Admin hits `POST /admin/referrals/<code>/disable` → status
  flips to DISABLED. Next invitee using that code →
  `CODE_DISABLED` abuse event.
- `/admin/referrals` shows top inviters + abuse table; disable
  form works.
- `/account/referrals` activity list shows the buyer's
  redemptions with invitee first name + initial only.

## 4. Known limitations

- **No email notification on redemption.** The activity list is
  the only surface. Wiring into Phase 12 notifications is a
  one-listener follow-up.
- **No leaderboards / public bragging.** Intentionally kept
  out of scope.
- **No "your referral has signed up" event before they pay.**
  The buyer sees nothing until the first paid order captures.
  This avoids over-promising and reduces the surface for
  signup-only abuse.
- **No invitee-side bonus boost for Plus members.** Phase 22
  Plus multiplier doesn't compound with referral bonuses (the
  multiplier only applies to EARN_PURCHASE / EARN_REFURB).
  Acceptable; future polish.
- **Disabled is permanent.** No admin enable.
- **No re-issue path for false-positive SAME_IP cases.** Admin
  has to write a manual points adjustment via the existing
  `applyDelta` ADJUST kind.
- **Address normalization is naive.** Won't catch
  "123 Main St" vs "123 Main Street". Acceptable for a launch
  pattern.

## 5. Files added

- `services/api/src/modules/referrals/referrals.service.ts`
- `services/api/src/modules/referrals/referrals.controller.ts`
- `services/api/src/modules/referrals/referrals.listener.ts`
- `services/api/src/modules/referrals/referrals.module.ts`
- `packages/api-client/src/endpoints/referrals.ts`
- `apps/buyer-web/src/app/account/referrals/page.tsx`
- `apps/admin-web/src/app/referrals/page.tsx`

## 6. Files edited

- `services/api/prisma/schema.prisma` — added `ReferralCode`,
  `ReferralRedemption`, `ReferralAbuseEvent`, two enums; added
  `User.referralCodeUsed`, `User.signupIp`, and three new
  back-relations on User.
- `services/api/src/app.module.ts` — registered `ReferralsModule`.
- `services/api/src/modules/auth/auth.service.ts` — `register`
  accepts an actor-meta object, stamps `referralCodeUsed` +
  `signupIp` on create.
- `services/api/src/modules/auth/auth.controller.ts` — passes
  ip + userAgent into `register`.
- `services/api/src/modules/auth/dto.ts` — `RegisterDto` gets
  an optional `referralCode` field.
- `packages/shared-types/src/dto/auth.ts` —
  `RegisterRequest.referralCode?`.
- `packages/api-client/src/index.ts` — re-export `referrals`.
- `apps/buyer-web/src/lib/auth-context.tsx` — `signUp` threads
  `referralCode`.
- `apps/buyer-web/src/lib/api.ts` — wired `ReferralsApi`.
- `apps/buyer-web/src/app/register/page.tsx` — reads `?ref=`
  and passes to signup.
- `apps/buyer-web/src/app/account/page.tsx` — added
  "Refer friends" tile.
- `apps/admin-web/src/lib/api.ts` — wired `AdminReferralsApi`.
- `apps/admin-web/src/components/Shell.tsx` — added `/referrals`
  nav.

## 7. Build / type checks not run

Environment has no Node/TS toolchain. Before merging:

```
pnpm prisma migrate dev --name phase_25_referrals
pnpm -r typecheck
pnpm -r build
```

Required env (all optional with sensible defaults):

```
LOYALTY_REFERRAL_INVITER_POINTS=500    # per-redemption award to inviter
LOYALTY_REFERRAL_INVITEE_POINTS=500    # per-redemption award to invitee
LOYALTY_REFERRAL_LIMIT_30D=25          # rolling cap per inviter
```

The migration adds three new tables, two new enums, and two new
nullable columns on User. No backfill required.
