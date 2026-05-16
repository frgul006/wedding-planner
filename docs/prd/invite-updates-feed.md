# PRD: Invite Updates Feed

**Version:** 0.3
**Status:** Functionally implemented; Brevkort updates visual parity pending
**Date:** 2026-05-16
**Scope:** Public updates for all guests

## Design source

Use the `Detaljer — updates published` state in `../design/brevkort-invite-states.md`. The extracted target screenshot is `../design/references/invite/detaljer-updates-published.png`. No separate no-updates artboard exists; when there are no published updates, omit the guest-facing `Uppdateringar` section entirely.

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
- As a guest, I can read the latest update on my invite page when one has been published.

## Functional requirements

- Admin page linked from `/admin` at `/admin/updates` to create/update feed items.
- Feed item fields:
  - Short title
  - Message text
  - Optional one link
  - Status: draft / published / archived
- Track `updated_at` when a feed item is edited.
- Feed items show in reverse time order on invite page.
- Latest updates are visible under the `Uppdateringar` section in the Brevkort `Detaljer` panel when at least one update is published.
- If no updates are published, omit the guest-facing `Uppdateringar` section entirely.
- Published updates render inline with date, title, and body. Optional links render as safe CTAs when present.

## Non-functional requirements

- Cached for fast mobile load.
- Changes show on invite pages quickly.
- Updates must match the Brevkort visual style and remain scannable on mobile.

## Acceptance criteria

- Admin post appears on guest invite page within 60 seconds.
- Guest sees at least the latest 5 published updates in the details panel when updates are published.
- Guest does not see the `Uppdateringar` section when no updates are published.
- Link opens in a new tab/device browser flow safely.

## Implementation notes

- Admin updates are managed at `/admin/updates` and linked from the dashboard.
- Updates are stored in `public.wedding_updates` with admin-scoped RLS.
- Server actions create and edit title, message, optional `http`/`https` link, and status.
- Only `published` updates show on valid invite pages; `draft` and `archived` updates stay admin-only.
- Valid invite pages show the latest five published updates in reverse `updated_at` order when updates are published.
- Guest-facing update links are sanitized before rendering and open in a new tab with `rel="noopener noreferrer"`.

## Out of scope

- Rich media content in feed posts
