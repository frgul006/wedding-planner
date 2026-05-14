# PRD: Invite Updates Feed

**Version:** 0.2
**Status:** Implemented, including Brevkort details placement
**Date:** 2026-05-14
**Scope:** Public updates for all guests

## Design source

Use the `Detaljer — updates published` and default empty-feed states in `../design/brevkort-invite-states.md`.

## Why this is needed

Guests need one place for late changes and day-of notes.

Static wedding info (venue, times, child policy, dress code, gifts, Spotify link) is managed in `wedding-event-settings.md`.

## Users

- Bride
- Groom
- Wedding staff
- Guests

## User stories

- As an admin, I can post day updates.
- As a guest, I can read the latest update on my invite page.
- As a guest, I can tell when there are no updates yet.

## Functional requirements

- Admin page linked from `/admin` at `/admin/updates` to create/update feed items.
- Feed item fields:
  - Short title
  - Message text
  - Optional one link
  - Status: draft / published / archived
- Track `updated_at` when a feed item is edited.
- Feed items show in reverse time order on invite page.
- Latest updates are visible under the `Uppdateringar` section in the Brevkort `Detaljer` panel.
- If no updates are published, show the Swedish empty state `Inga uppdateringar än.`
- Published updates render inline with date, title, and body. Optional links render as safe CTAs when present.

## Non-functional requirements

- Cached for fast mobile load.
- Changes show on invite pages quickly.
- Updates must match the Brevkort visual style and remain scannable on mobile.

## Acceptance criteria

- Admin post appears on guest invite page within 60 seconds.
- Guest sees at least the latest 5 published updates in the details panel.
- Guest sees `Inga uppdateringar än.` when no updates are published.
- Link opens in a new tab/device browser flow safely.

## Implementation notes

- Admin updates are managed at `/admin/updates` and linked from the dashboard.
- Updates are stored in `public.wedding_updates` with admin-scoped RLS.
- Server actions create and edit title, message, optional `http`/`https` link, and status.
- Only `published` updates show on valid invite pages; `draft` and `archived` updates stay admin-only.
- Valid invite pages show the latest five published updates in reverse `updated_at` order.
- Guest-facing update links are sanitized before rendering and open in a new tab with `rel="noopener noreferrer"`.

## Out of scope

- Rich media content in feed posts
