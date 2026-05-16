## Parent PRD

`docs/prd/invite-visual-parity-execution-plan.md`

## Type

AFK

## What to build

Add deterministic local invite visual fixtures for stable RSVP and update states so future visual parity work can navigate to known URLs without creating data manually.

Reference: "Item 27 decisions" stable seeded invite tokens and database rows.

## Acceptance criteria

- [x] Deterministic local fixture tokens exist for RSVP `Nej` and RSVP `Kanske` saved-answer/edit states.
- [x] A deterministic local fixture exists for a +1-expanded RSVP state with named +1 details.
- [x] Deterministic published update fixture data exists for the details panel updates-published state.
- [x] Fixture helpers cleanly create or reset only their own E2E/visual data without disturbing unrelated tests.
- [x] Fixture routes/URLs are documented for use by visual QA and follow-up UI PRs.
- [x] Tests assert that each fixture URL loads the expected key content.

## Blocked by

- Blocked by `issues/001-explicit-partner-name-settings.md`

## PRD sections addressed

- Item 27 decisions: deterministic seeded invite tokens and database rows for stable visual states
- Branch and PR boundaries: item 27 owns seeds, test helpers, fixtures, and Playwright specs
