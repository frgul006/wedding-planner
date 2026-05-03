# PRD: Invite Page Event Info and Gift Details

**Version:** 0.1
**Status:** Draft
**Date:** 2026-05-03
**Scope:** Public invite content and admin-managed wedding details

## Why this is needed
Guests need one clear info block with all wedding details.

## Users
- Invited guests
- Bride
- Groom
- Wedding staff

## User stories
- As an admin, I can manage the wedding info block in one place.
- As a guest, I can see place, map link, times, child policy, gift info, and playlist link on my personal invite.
- As a guest, I can open the map link if I need directions.

## Functional requirements
- This PRD uses event fields from `wedding-event-settings.md`.
- Personal invite page (`/invite/:token`) shows the wedding info block in a clear section.
- If a field is missing, show a simple placeholder like "Coming soon".

## Non-functional requirements
- Sections must be easy to scan on mobile.
- Links open safely and clearly in a new tab/app.

## Acceptance criteria
- Guest sees the complete wedding info block on their invite page.
- Admin updates are visible after a fresh invite load.
- Google Maps link opens map app or browser correctly.

## Out of scope
- Guest-specific custom info blocks
- Auto-detect child policy by country