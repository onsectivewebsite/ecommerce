# Phase 19 — Repair Network & Service Tickets

Date opened: 2026-05-18
Predecessor: Phase 18 (Returns Liquidation & Outlet)

## 1. Why this phase

Phase 14's `WarrantyClaim` already has a `RESOLVED_REPAIR` resolution
path, but there's no actual ticketing/routing for the physical repair.
Today the admin clicks "repair" and the rest happens in someone's
spreadsheet. As repair volume grows, that breaks.

Phase 19 stands up the repair network: verified `RepairPartner`s with
declared capabilities and capacity, `ServiceTicket`s with a full
status timeline, and an integration where resolving a warranty claim
as `RESOLVED_REPAIR` either (a) auto-creates a ticket routed to the
best partner, or (b) returns an admin-actionable suggestion when no
partner has capacity.

The buyer side stays simple — the warranty page now shows the ticket
status + inbound/outbound tracking when present, so the buyer knows
where their device is in the repair flow without contacting support.

## 2. Scope (in)

### 2.1 RepairPartner registry
- `RepairPartner` table: `{ id, userId, displayName, status,
  capabilityCategorySlugs[], dailyCapacity, turnaroundHours,
  serviceAddress*, notes, createdAt, updatedAt }`.
- Linked to a `User` (the partner's primary login — same auth as
  sellers). The user role stays as-is; partners don't get a new
  global role in this phase. They access partner endpoints via a
  JWT that matches `RepairPartner.userId`.
- Status enum: `PENDING | ACTIVE | PAUSED | REVOKED`.
- Admin creates/edits via `/admin/repair-network`.

### 2.2 ServiceTicket lifecycle
- `ServiceTicket` table: `{ id, warrantyClaimId (unique FK), partnerId
  (nullable until assigned), status, buyerNote, partnerNote,
  estimatedPartsCostMinor, currency, inboundCarrier, inboundTracking,
  outboundCarrier, outboundTracking, completedAt, cancelledAt,
  cancelledReason, createdAt, updatedAt }`.
- Status enum: `CREATED | ASSIGNED | INBOUND | RECEIVED | DIAGNOSING |
  REPAIRING | OUTBOUND | COMPLETED | CANCELLED`.
- `ServiceTicketEvent` table: `{ ticketId, kind, actorUserId, note,
  payload, createdAt }` — append-only timeline for audit.

### 2.3 Routing
- When a warranty claim resolves as `RESOLVED_REPAIR`, the warranty
  service calls `RepairNetworkService.createTicketFromClaim`. The
  routing picks an ACTIVE partner where:
  1. The warranty item's product category is in
     `capabilityCategorySlugs`.
  2. The partner's current open-ticket count for the day is below
     `dailyCapacity`.
  3. Ties broken by lowest `turnaroundHours`.
- If no eligible partner exists, the ticket is still created at
  status `CREATED` with `partnerId = null`. Admin can route manually.
- If multiple eligible partners exist, deterministic pick (lowest
  turnaround, then alphabetical id).

### 2.4 Partner endpoints
- `GET /partner/repair/tickets` — partner sees only their own.
- `POST /partner/repair/tickets/:id/update` — moves status forward,
  attaches notes/cost. Backward transitions are admin-only.
- Allowed forward transitions:
  `ASSIGNED → INBOUND → RECEIVED → DIAGNOSING → REPAIRING → OUTBOUND
  → COMPLETED`. Skipping intermediate states is allowed for partner
  convenience (e.g., partner records OUTBOUND directly when shipping
  a fixed unit).

### 2.5 Completion + warranty closure
- When the ticket transitions to `COMPLETED`, the linked
  `WarrantyClaim` is updated:
  - If still `OPEN | APPROVED`: set `status = RESOLVED_REPAIR`,
    `resolutionRef = ticket:<id>`, `resolvedAt = now`.
  - Otherwise: leave alone (admin already finalized it differently).
- Event `repair.ticket.completed` is emitted for downstream consumers.

### 2.6 Buyer visibility
- The Phase 14 buyer warranty list (`/account/warranty`) is extended
  to render a small "Repair ticket" line per claim that has a ticket:
  status, partner name, tracking number if present.

### 2.7 Admin views
- `/repair-network` — partner registry CRUD + recent ticket activity.
- Per-partner page (linked from registry) — partner-scoped ticket
  list + capacity utilization.

## 3. Scope (out)

- Buyer-direct repair requests outside a warranty claim. Repairs are
  warranty-driven in Phase 19; an out-of-warranty paid-repair flow is
  a future iteration.
- Parts inventory management. We capture `estimatedPartsCostMinor` as
  a number but don't track a parts catalog.
- Partner payouts. Repair partner billing model is intentionally
  deferred — costs are tracked but billing/payouts integrate with
  the existing payouts module in a follow-on phase.
- Cross-border repair routing. Same-country only.

## 4. Architectural decisions made up front

### 4.1 RepairPartner is NOT a Seller
A repair partner provides a service, not stock. Forcing them onto
the `Seller` model would muddy seller-health scoring, payouts,
listing-fee logic, and the brand-authorization gate — none of which
apply to repair work. They get their own table with their own
status lifecycle.

### 4.2 No new global role
Partner endpoints are gated by `JwtAuthGuard` + a runtime check that
the requesting user owns a RepairPartner row. Skips the
RBAC-migration cost. If volume warrants a `REPAIR_PARTNER` role
later, we add it then.

### 4.3 Routing is best-effort, not blocking
If no partner has capacity, `createTicketFromClaim` still writes the
ticket (unassigned) so the warranty resolution doesn't fail. Admin
sees the unassigned ticket in the queue and routes manually.

### 4.4 Forward-only partner transitions
Partners can move tickets forward but not backward. Backward
corrections require admin — protects against accidental rollback
that would confuse buyers.

### 4.5 Ticket completion writes the warranty claim
We deliberately wire this direction (ticket → claim) rather than
require admin to close both. Ops lesson from Phase 14: any flow that
requires the admin to update two coupled records loses one half. The
ticket COMPLETED transition is the single point of truth.

### 4.6 Per-claim ticket uniqueness
`ServiceTicket.warrantyClaimId` is unique. A warranty claim has at
most one repair ticket. If a repair fails and we open a second
attempt, the model is: cancel the existing ticket and open a new
warranty claim (which would normally land as a replacement or refund).

## 5. Acceptance criteria

- Admin registers a RepairPartner "FixIt Co" with capabilities
  `[phones, laptops]`, dailyCapacity 25, turnaroundHours 48.
- Buyer files a warranty claim on a refurb phone. Admin approves,
  then resolves as `RESOLVED_REPAIR`. A ServiceTicket is auto-
  created and routed to FixIt Co, status `ASSIGNED`.
- FixIt Co logs in (their userId) and sees the ticket in
  `/partner/repair/tickets`. They mark INBOUND with a tracking
  number, then RECEIVED, then REPAIRING, then OUTBOUND with a
  tracking number, then COMPLETED.
- The buyer's warranty page now shows ticket status + carrier
  tracking numbers throughout.
- Completion automatically marks the WarrantyClaim
  `RESOLVED_REPAIR`, `resolvedAt` set, `resolutionRef`
  `ticket:<id>`.
- Skipping intermediate statuses (partner jumps straight to
  OUTBOUND from RECEIVED) is allowed.
- Going backward (OUTBOUND → REPAIRING) requires admin.
- Resolving another claim when no partner has capacity creates an
  unassigned ticket; admin can route it manually.
- `doc/phase-19-debug.md` captures decisions + limitations.
