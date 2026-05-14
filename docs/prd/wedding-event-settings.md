# PRD: Wedding Event Settings (Source of Truth)

**Version:** 0.3
**Status:** Implemented, including Brevkort prerequisite fields
**Date:** 2026-05-14
**Scope:** Core wedding details and guest hub behavior settings

## Why this is needed
The wedding page, invite page, and QR hub must show one consistent set of details, so they should come from one shared settings record.

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
  - Venue area/city display text
  - Google Maps link
  - Structured time plan entries with time and label (for example: `{ time: "16:30", label: "Välkomstdrinkar" }`)
  - Dress code text (for example: festive summer formal)
  - Child policy text (for example: child-free)
  - Gift info text
  - Spotify playlist link (optional)
  - Public invite-support contact email (optional; used on invalid-link pages)
  - Allow anonymous QR hub uploads (default on; if off, upload requires a valid guest navigation cookie)
  - Require photo review before showing uploads (default off/open)
- Settings are reused by:
  - `/invite/:token` page
  - QR wedding hub page
- The `/invite/:token` Brevkort details panel uses these settings for `Tidsplan`, `Plats`, `Klädkod`, `Gåvor`, and `Musik`.
- Updating settings updates both pages on next load.
- Keep a simple draft/save behavior with clear success or error text.

## Non-functional requirements
- Easy to read on mobile.
- Input values are validated (required fields and valid URL format where needed).
- Guest-facing values render in Swedish where the field is shown directly to guests.

## Implementation notes
- The current baseline schema does not fully cover the Brevkort artboards.
- Add a schema/admin settings migration, or document explicit mappings, for venue area/city, structured time-plan rows, dress code, child policy, and invite-support email before implementing the Brevkort details UI.
- Prefer explicit fields over overloading the generic `policy` field so admins can edit each Brevkort details card without ambiguity.

## Acceptance criteria
- Admin can update one settings field without affecting invite links.
- Guest sees updated settings after refresh.
- The same venue/map/playlist details are identical on invite page and QR hub.
- Brevkort invite details can render dress code and gift cards from settings.
- Anonymous QR hub upload is allowed by default, and disabling it makes photo upload require a valid guest navigation cookie.
- Photo review is off by default, so verified uploaded photos can appear without manual approval until an admin enables review.

## Out of scope
- Multi-wedding management in one install
- Complex scheduling engine
