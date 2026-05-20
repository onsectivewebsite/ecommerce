# Phase 19 — Debug Pass

Companion to `phase-19.md`. Decisions made, seams to watch, what
reviewers should test.

## 1. The invariants Phase 19 enforces

1. **One ticket per warranty claim.** `ServiceTicket.warrantyClaimId
   @unique`. If repair fails and another attempt is needed, the model
   is: cancel the existing ticket and open a new warranty claim
   (which typically resolves as replacement/refund).
2. **Partners move tickets forward only.** Backward transitions
   (e.g., OUTBOUND → REPAIRING) require admin. Protects against
   accidental rollback that would confuse buyers tracking status.
3. **Ticket COMPLETED writes the WarrantyClaim.** Single source of
   truth. Admin doesn't need to update two coupled records.
4. **Routing is best-effort, never blocking.** If no partner has
   capacity, the ticket is still written (unassigned, status
   `CREATED`), and admin sees it in the queue.

## 2. Non-obvious decisions

### 2.1 `RepairPartner` is NOT a `Seller`
A repair partner provides a service, not stock. Forcing them onto
the Seller model would muddy seller-health scoring, payouts, listing
fees, and the brand-authorization gate — none of which apply. They
get their own table with their own status lifecycle.

### 2.2 No new global role
Partner endpoints are gated by `JwtAuthGuard` plus a runtime check
inside the service that the requesting user owns a `RepairPartner`
row. Skips the RBAC-migration cost. If volume warrants a
`REPAIR_PARTNER` role later, we add it then.

### 2.3 Forward-only enum order matters
`FORWARD_ORDER` in `RepairNetworkService` is the canonical
forward path. `partnerUpdateTicket` checks `toIdx > fromIdx`. If
the enum is reordered, the partner update validation must be
re-checked.

### 2.4 Skipping intermediate statuses is allowed
A partner can move from RECEIVED directly to OUTBOUND if they
shipped the fixed unit fast. Reasoning: ops convenience > status
granularity. The event log still captures the jump.

### 2.5 Routing tiebreakers
Eligible partners are ordered by `turnaroundHours ASC, id ASC`. Then
the first one whose open-ticket count is below capacity wins.
Deterministic, no random selection — important for replayability of
audit trails.

### 2.6 Warranty integration via direct service call (not event)
`WarrantyService.resolve(RESOLVED_REPAIR)` calls
`RepairNetworkService.createTicketFromClaim` directly. We chose the
direct call over an event listener because the warranty's
`resolutionRef` field needs to be set with the new ticket id in the
same response, and event handlers run async. Trade-off accepted —
the modules now have an explicit dependency (`RepairNetworkModule`
is `@Global()` so injection works without an import cycle).

### 2.7 Buyer-side per-row fetch instead of bulk-join
The buyer warranty page fetches the repair ticket per claim row via
a small client component. We could have joined the ticket onto the
`/warranty/claims` response, but only ~5% of claims will have a
ticket (refund/replace paths don't), and the lazy fetch keeps the
list endpoint shape stable for older clients.

### 2.8 Partner unable-to-access partner endpoints fails clearly
`partnerQueue()` and `partnerUpdateTicket()` throw
`ForbiddenException('Not a repair partner')` when the JWT user has
no `RepairPartner` row. The shipping-web `/repair` page checks for
that exact message and shows an "ask an admin" hint instead of
"empty queue", which would be confusing.

## 3. Things to test end-to-end

- Admin registers a RepairPartner "FixIt Co" with `userId` of an
  existing user, capabilities `[phones, laptops]`, capacity 25,
  72h SLA.
- Buyer files a warranty claim on a refurbished phone. Admin
  approves, then resolves as `RESOLVED_REPAIR`. Expect:
  - A `ServiceTicket` is created with `partnerId = FixIt Co`, status
    `ASSIGNED`.
  - The `WarrantyClaim.resolutionRef` is `ticket:<id>`.
- FixIt Co user logs into shipping-web → `/repair` → sees the
  ticket. Moves INBOUND with carrier + tracking. Then RECEIVED.
  Then REPAIRING. Then OUTBOUND with carrier + tracking. Then
  COMPLETED.
- Verify the buyer's warranty page now shows the ticket status +
  carrier/tracking lines throughout.
- COMPLETED transition automatically updates the WarrantyClaim
  status to `RESOLVED_REPAIR`, sets `resolvedAt`, and
  `resolutionRef = ticket:<id>`.
- Try a backward partner update (OUTBOUND → REPAIRING) → 400
  BadRequest "Partners can only move tickets forward".
- Admin moves a ticket backward → succeeds, event logged.
- Resolve another claim when no partner has matching capabilities →
  unassigned ticket appears under `/admin/repair-network` →
  Unassigned tab. Admin assigns manually.
- Pause the partner → next routed claim creates an unassigned
  ticket (or routes to a different active partner if any).
- Cancel a ticket via admin → status `CANCELLED`, event captured,
  the WarrantyClaim is NOT auto-updated (cancel is intentional and
  may need follow-up resolution).

## 4. Known limitations

- No partner-facing billing/payouts. Costs are tracked
  (`estimatedPartsCostMinor`) but not paid out via the existing
  payouts module. Follow-on phase.
- No buyer-direct repair requests outside a warranty claim. Repairs
  in Phase 19 are warranty-driven only.
- No parts catalog. We capture an estimated cost as a number, not
  structured parts data.
- Routing ignores geographic proximity. We use country only via
  `RepairPartner.serviceCountry` as a soft signal (not enforced).
- Capacity is measured by "open tickets right now" not "tickets
  opened today". Simpler, but could oscillate if partners flush
  large batches.
- No SLA breach signal yet. `turnaroundHours` is informational;
  a scheduler that flags overdue tickets is deferred.

## 5. Files added

- `services/api/src/modules/repair-network/{repair-network.service,repair-network.controller,repair-network.module,dto}.ts`
- `packages/api-client/src/endpoints/repair-network.ts`
- `apps/admin-web/src/app/repair-network/page.tsx`
- `apps/shipping-web/src/app/repair/page.tsx`

## 6. Files edited

- `services/api/prisma/schema.prisma` — added `RepairPartnerStatus`,
  `ServiceTicketStatus`, `ServiceTicketEventKind` enums + 3 models
  (`RepairPartner`, `ServiceTicket`, `ServiceTicketEvent`).
  Back-relations on `User` and `WarrantyClaim`.
- `services/api/src/app.module.ts` — registered `RepairNetworkModule`.
- `services/api/src/modules/warranty/warranty.service.ts` — injects
  `RepairNetworkService`; resolving as `RESOLVED_REPAIR` auto-creates
  the ticket and sets `resolutionRef` to `ticket:<id>`.
- `packages/api-client/src/index.ts` — re-export `repair-network`.
- `apps/{admin,buyer,shipping}-web/src/lib/api.ts` — wired
  `RepairNetworkApi`.
- `apps/admin-web/src/components/Shell.tsx` — added Repair nav.
- `apps/shipping-web/src/components/Shell.tsx` — added Repair queue nav.
- `apps/buyer-web/src/app/account/warranty/page.tsx` — split claim
  rows into a per-row client component that lazily fetches the
  repair ticket and renders status + tracking.

## 7. Build / type checks not run

Environment has no Node/TS toolchain. Before merging:

```
pnpm prisma migrate dev --name phase_19_repair_network
pnpm -r typecheck
pnpm -r build
```

The migration adds 3 enums + 3 tables and a 1:1 FK
(`ServiceTicket.warrantyClaimId @unique`). No data backfill needed.
Existing warranty claims with `resolutionRef='repair:<claimId>'`
from before this phase are NOT migrated to point at a ticket;
they still display the legacy reference string. New `RESOLVED_REPAIR`
resolutions get the new `ticket:<id>` reference.
