## Parent PRD

`docs/prd/invite-visual-parity-execution-plan.md`

## Type

AFK

## What to build

Implement the item 24 invite shell contract: a centered 390 px postcard experience that shows one primary panel at a time, supports left/right swipe, preserves hash deep links, and keeps dot/arrow navigation in sync.

Reference: "Item 24 decisions" shell/navigation behavior.

## Acceptance criteria

- [x] The invite route renders a centered 390 px postcard shell on mobile and wider desktop screens.
- [x] Only one primary panel is visible at a time for `Inbjudan`, `Detaljer`, and `OSA`.
- [x] Left/right swipe changes panels on touch-capable devices or simulated Playwright touch events.
- [x] `#inbjudan`, `#detaljer`, and `#osa` deep links open the matching panel on initial load.
- [x] Dot and arrow controls update the active panel and URL hash consistently.
- [x] Left arrow is disabled on the first panel and right arrow is disabled on the last panel; navigation does not wrap.
- [x] Existing server data loading, invite token validation, and RSVP behavior continue to pass regression tests.

## Blocked by

- Blocked by `issues/001-explicit-partner-name-settings.md`
- Blocked by `issues/002-sync-production-partner-name-fields.md`

## PRD sections addressed

- Item 24 decisions: 390 px centered shell, one primary panel, swipe, hash deep links, dots/arrows, disabled ends
- Branch and PR boundaries: item 24 primarily touches invite UI components and shell behavior
