# Phase 40 — Storewide Announcements — Debug Pass

> What shipped, the invariants, every endpoint, and the deferred follow-ons.

## What shipped

- **Two models** (`Announcement`, `AnnouncementDismissal`) + one enum
  (`AnnouncementLevel`).
- **`AnnouncementsService`** — `currentActive` (the single most-recently-
  started active banner in its window), `myDismissals`, `dismiss` (idempotent
  upsert), admin `list / create / update / remove`.
- **Three controllers** — no-auth `GET /announcements/current`, JWT
  `my-dismissals` + `dismiss`, ADMIN CRUD under `/admin/announcements`.
- **buyer-web** — `AnnouncementBar` mounted above `TopBar` in the root
  layout. Fetches the current banner, filters against server-side
  dismissals when signed-in, against `localStorage` when anonymous.
- **admin-web** — `/announcements` page with a publish form + a list of
  scheduled / active / past announcements with activate-toggle and delete.

## Invariants

1. **At most one banner is shown at a time** — `currentActive` orders by
   `startsAt` desc and takes the most recent. Two simultaneous active
   banners do not stack.
2. **Active = `isActive` AND `startsAt ≤ now` AND (`endsAt = null` OR
   `endsAt ≥ now`).**
3. **`dismiss` is idempotent** — upsert on the unique `(userId,
   announcementId)`; dismissing twice is a no-op.
4. **Anonymous dismiss is client-side** — no `AnnouncementDismissal` row is
   created without a JWT.
5. **Admin edits don't reset dismissals.** Republishing as a new
   announcement is the only way to re-surface to dismissed buyers.
6. **Deleting an announcement cascades its dismissals** — no orphan rows.

## Endpoint inventory

| Method | Path | Auth |
|--------|------|------|
| GET  | `/announcements/current` | public |
| GET  | `/announcements/my-dismissals` | JWT |
| POST | `/announcements/:id/dismiss` | JWT |
| GET  | `/admin/announcements` | ADMIN |
| POST | `/admin/announcements` | ADMIN |
| PATCH | `/admin/announcements/:id` | ADMIN |
| DELETE | `/admin/announcements/:id` | ADMIN |

## Schema additions

- `Announcement`, `AnnouncementDismissal` models.
- `AnnouncementLevel` enum (`INFO` / `SUCCESS` / `WARNING`).
- `User.announcementDismissals` back-relation.

## Manual test list

1. **Publish.** Admin → `/announcements` → fill form → "Publish".
2. **Public.** Open the buyer storefront (signed-out) → the banner renders
   above the top bar, toned by level.
3. **Dismiss anon.** Click `×` → banner disappears immediately; reload →
   still hidden (localStorage).
4. **Dismiss signed-in.** Sign in (different browser) → see banner →
   dismiss → reload → still hidden (server-side dismissal). Sign in on a
   second device → already dismissed.
5. **Schedule.** Set `startsAt` to 1 hour in the future → banner doesn't
   show yet; after 1 hour it appears.
6. **End-of-window.** Set `endsAt` to 30 seconds in the future → after it
   passes, banner disappears on next refresh.
7. **Deactivate.** Admin toggles `Deactivate` → banner disappears for
   everyone immediately.

## Decisions worth highlighting

- **One banner at a time, most-recent first.** A stack of banners competes
  for the buyer's attention; a single banner is the retail norm.
- **Public `current` endpoint is no-auth.** The buyer-web layout renders
  on every page including anonymous ones; an auth round-trip would block
  the first paint.
- **Server-side dismiss for signed-in, localStorage for anonymous.** Same
  user-experience either way; signed-in users carry dismissals across
  devices, anonymous users don't.
- **Plain-text `message`, no Markdown / HTML.** The banner injects into
  every page; admins shouldn't be able to ship arbitrary markup into the
  layout. The optional CTA link covers the formatting need.

## Limitations / follow-ons

- **No per-segment targeting** — every visitor sees the same banner; no
  "Plus members only" or per-country variants.
- **No A/B testing** — `experiments` exists; banner copy isn't yet wired
  through it.
- **No scheduled republish** — once dismissed, always dismissed (for that
  banner); there's no "re-show after N days" knob.
- **Admin UI does not yet support editing the body** — only toggling
  active / deleting. (Creating a fresh announcement is the intended flow.)
