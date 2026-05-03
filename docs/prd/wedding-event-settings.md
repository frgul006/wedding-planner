# PRD: Wedding Event Settings (Source of Truth)

**Version:** 0.1
**Status:** Draft
**Date:** 2026-05-03
**Scope:** Core wedding details that appear on guest pages and QR hub

## Why this is needed
The wedding page and QR hub must show one consistent set of details, so they should come from one shared settings record.

## Users
- Bride
- Groom
- Wedding staff

## User stories
- As an admin, I can add and edit the wedding details once.
- As a guest, I see the same details on every page that shows wedding info.
- As an admin, I can change details up to the event day.

## Functional requirements
- Create one editable wedding settings record in `/admin`.
- Fields:
  - Couple names
  - Wedding date
  - Venue name and address
  - Google Maps link
  - Time plan entries (for example: pre-drink, dinner, ceremony, end)
  - Child policy text (for example: child-free)
  - Gift info text
  - Spotify playlist link (optional)
- Settings are reused by:
  - `/invite/:token` page
  - QR wedding hub page
- Updating settings updates both pages on next load.
- Keep a simple draft/save behavior with clear success or error text.

## Non-functional requirements
- Easy to read on mobile.
- Input values are validated (required fields and valid URL format where needed).

## Acceptance criteria
- Admin can update one settings field without affecting invite links.
- Guest sees updated settings after refresh.
- The same venue/map/playlist details are identical on invite page and QR hub.

## Out of scope
- Multi-wedding management in one install
- Complex scheduling engine