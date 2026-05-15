# PRD: Invite Page Event Info and Gift Details

**Version:** 0.2
**Status:** Functionally implemented; Brevkort details visual parity pending
**Date:** 2026-05-14
**Scope:** Public invite content and admin-managed wedding details

## Design source

Use the `Detaljer` panel in `../design/brevkort-invite-states.md` as the target layout for invite details. The extracted target screenshot is `../design/references/invite/detaljer-updates-published.png`; no separate no-updates artboard exists in the export, so use the same layout with the feed rows removed for the empty state.

## Why this is needed
Guests need one clear info block with all wedding details before they answer OSA/RSVP.

## Users
- Invited guests
- Bride
- Groom
- Wedding staff

## User stories
- As an admin, I can manage the wedding info block in one place.
- As a guest, I can see place, map link, times, dress code, child policy, gift info, and playlist link on my personal invite.
- As a guest, I can open the map link if I need directions.
- As a guest, I can move from event details directly to OSA.

## Functional requirements
- This PRD uses event fields from `wedding-event-settings.md`.
- Personal invite page (`/invite/:token`) shows details in the Brevkort `Detaljer` panel.
- The details panel must present content in this order:
  1. `Tidsplan` — time plan rows with time and label.
  2. `Plats` — venue name, area/city, address, and `Visa karta` link.
  3. Two-up cards for `Klädkod` and `Gåvor`.
  4. `Musik` — Spotify playlist CTA when configured.
  5. `Uppdateringar` — latest published updates or empty state.
  6. `Vidare till OSA` CTA.
- If a required text field is missing, show a simple Swedish placeholder such as `Kommer snart`.
- If map or Spotify URL is missing, show non-clickable coming-soon copy instead of a broken link.
- Links must open safely and clearly in a new tab/app where appropriate.
- Details are visible only on valid-token invite pages.

## Non-functional requirements
- Sections must be easy to scan on mobile.
- Details must keep the Brevkort visual style from `public-invite-page.md`.
- Links and CTAs need accessible names that describe their destination.

## Implementation notes
- The Brevkort details panel depends on data-model/settings support for structured time-plan rows, venue area/city display text, dress code, child policy, gift info, and Spotify URL.
- Add those fields or document explicit mappings before implementing this panel.

## Acceptance criteria
- Guest sees the complete wedding info block on their invite page.
- Details appear before the OSA panel in the invite flow.
- Admin updates to wedding settings are visible after a fresh invite load.
- Google Maps link opens map app or browser correctly when configured.
- Missing optional URLs do not render broken links.

## Out of scope
- Guest-specific custom info blocks
- Auto-detect child policy by country
