# PRD: Public Invite Page

**Version:** 0.1
**Status:** Implemented
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
- `/invite` without a token must render the same safe invalid-link page as an invalid token.
- Show a clear event summary (names, date/time, venue).
- Show a base details section driven from wedding settings:
  - Venue and Google Maps link
  - Time plan (for example, pre-drink, dinner)
  - Child policy (for example, child-free)
  - Gift info
  - Spotify playlist link
- Wedding settings are defined in `wedding-event-settings.md` (single source of truth).
- If token is invalid or missing, show: "Invite link not valid".
- Invalid or missing-token pages must not show guest names, wedding names, or other wedding data.
- If token is valid, show an interactive RSVP area where guests can submit or update their RSVP.
- If the linked guest already has an RSVP response, show the current answer and pre-fill the RSVP form.
- If token is valid, show an Updates placeholder with "Updates coming soon"; the real updates feed is deferred to build item 11.
- The page can be used without login.

## Non-functional requirements
- Mobile-first layout.
- Fast load for low-bandwidth connections.
- Accessible text contrast and labels.

## Acceptance criteria
- Valid token opens the invite page quickly.
- Invalid token never shows guest PII.
- Missing-token `/invite` shows the generic invalid-link page and no guest or wedding data.
- Wedding details section is visible before RSVP form.
- Valid invite pages include the interactive RSVP form and a non-interactive Updates coming-soon placeholder.

## Out of scope
- Guest login or account management
- Multiple wedding pages in one link
- Real invite updates feed, which is build item 11
