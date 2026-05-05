# PRD: Invite Updates Feed

**Version:** 0.1
**Status:** Implemented
**Date:** 2026-05-03
**Scope:** Public updates for all guests

## Why this is needed

Guests need one place for late changes and day-of notes.

Static wedding info (venue, times, child policy, gifts, Spotify link) is managed in `wedding-event-settings.md`.

## Users

- Bride
- Groom
- Wedding staff
- Guests

## User stories

- As an admin, I can post day updates.
- As a guest, I can read the latest update on my invite page.

## Functional requirements

- Admin page in `/admin` to create/update feed items.
- Feed item fields:
  - Short title
  - Message text
  - Optional one link
  - Status: draft / published / archived
- Track `updated_at` when a feed item is edited.
- Feed items show in reverse time order on invite page.
- Latest updates visible under an "Updates" section.

## Non-functional requirements

- Cached for fast mobile load.
- Changes show on invite pages quickly.

## Acceptance criteria

- Admin post appears on guest invite page within 60 seconds.
- Guest sees at least the latest 5 updates.
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
