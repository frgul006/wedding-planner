# PRD: Public Invite Page

**Version:** 0.1
**Status:** Draft
**Date:** 2026-05-03
**Scope:** Guest-facing invite landing page

## Why this is needed
Guests need one simple place to open their invite and see all wedding details.

## Users
- Invited guests

## User stories
- As a guest, I can open my invite with my link.
- As a guest, I can view wedding details in one page.
- As a guest, I can see if my link is not valid.

## Functional requirements
- Public route format: `/invite/:token`.
- Show a clear event summary (names, date/time, venue).
- Show a base details section driven from wedding settings:
  - Venue and Google Maps link
  - Time plan (for example, pre-drink, dinner)
  - Child policy (for example, child-free)
  - Gift info
  - Spotify playlist link
- Wedding settings are defined in `wedding-event-settings.md` (single source of truth).
- If token is invalid or missing, show: "Invite link not valid".
- If token is valid, show RSVP area and update feed section.
- The page can be used without login.

## Non-functional requirements
- Mobile-first layout.
- Fast load for low-bandwidth connections.
- Accessible text contrast and labels.

## Acceptance criteria
- Valid token opens the invite page quickly.
- Invalid token never shows guest PII.
- Wedding details section is visible before RSVP form.

## Out of scope
- Guest login or account management
- Multiple wedding pages in one link