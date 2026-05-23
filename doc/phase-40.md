# Phase 40 — Storewide Announcements

> Admin-driven site-wide banners ("Free shipping this week", "Maintenance
> at 2am") shown to shoppers across the buyer storefront, with per-buyer
> dismiss.

## Goal

A predictable, scheduled way for the platform team to communicate with
every visitor without shipping code — a single Markdown-free banner at
the top of every buyer-web page, scheduled with start / end timestamps,
toned by severity, optionally carrying a call-to-action link. Buyers can
dismiss a banner; the same banner never reappears for that buyer.

## Data model

Two models + one enum.

- **`Announcement`** — `title`, `message`, `level`, optional `linkUrl` +
  `linkLabel`, `startsAt`, `endsAt?`, `isActive`, timestamps. An
  announcement is *currently active* when `isActive = true` AND
  `now >= startsAt` AND (`endsAt = null` OR `now <= endsAt`).
- **`AnnouncementDismissal`** — `(userId, announcementId)` unique. The
  buyer pressed "dismiss"; the public endpoint hides it from them.
- **`AnnouncementLevel`** — `INFO` / `SUCCESS` / `WARNING`. Drives the
  banner's tone.

## Invariants

1. **At most one announcement is shown at a time.** When several are
   simultaneously active, the most-recently-started one wins
   (`startsAt` desc). This keeps the banner predictable.
2. **A dismissal hides the announcement only for that buyer.** Other
   buyers — and the same buyer when not signed in — still see it.
3. **Anonymous dismiss is client-side** (`localStorage`), not server-side
   — no row is written for a guest, and there is no risk of orphaned
   dismissal rows.
4. **`endsAt = null` is "open-ended"** — the banner runs until an admin
   flips `isActive = false`.
5. **Admin edits don't clear dismissals.** Editing the title or message
   of an existing announcement still hides it from buyers who already
   dismissed it; an admin who wants a fresh notification should publish
   a new announcement.

## Endpoints

| Method | Path | Auth | Notes |
|--------|------|------|-------|
| GET  | `/announcements/current` | public (JWT optional) | the single active banner for this viewer (null if none / dismissed) |
| POST | `/announcements/:id/dismiss` | JWT | dismiss this announcement for me |
| GET  | `/admin/announcements` | ADMIN | full list with isActive + window |
| POST | `/admin/announcements` | ADMIN | create |
| PATCH | `/admin/announcements/:id` | ADMIN | update any field |
| DELETE | `/admin/announcements/:id` | ADMIN | hard-delete (cascades dismissals) |

`GET /announcements/current` is intentionally a no-auth public endpoint so
the buyer-web layout can render the banner on the very first paint. If a
JWT is presented, the response is filtered against the dismissals table; if
not, the raw active banner is returned and the client may filter locally
via `localStorage`.

## Frontend

- **buyer-web** — an `AnnouncementBar` component, mounted in the root
  layout above `TopBar`. It fetches `/announcements/current`, renders the
  banner toned by `level`, and dismisses via the JWT endpoint (signed-in)
  or `localStorage` (anonymous).
- **admin-web** — `/announcements`: a list of all announcements with an
  active/inactive badge, dates, and inline edit / activate-toggle /
  delete; a create form at the top of the page.

## Decisions

- **One banner at a time** rather than a stack — a stack invites noise and
  competing CTAs. A single banner is the de-facto retail pattern.
- **Per-user dismiss persistence**, not "show once per session" — a buyer
  who closed last week's "Holiday sale" shouldn't see it again this week
  while the window is still open.
- **No Markdown** — `message` is rendered as plain text. Admins do not
  inject HTML or JS into the layout of every page; the optional
  `linkUrl` + `linkLabel` covers the CTA need cleanly.
- **`endsAt` nullable** — open-ended banners (incident notices, "free
  shipping until further notice") shouldn't be forced to invent an end
  date.
