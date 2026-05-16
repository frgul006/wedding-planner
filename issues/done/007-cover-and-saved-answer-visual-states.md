## Parent PRD

`docs/prd/invite-visual-parity-execution-plan.md`

## Type

AFK

## What to build

Bring the invite cover and saved-answer states to close visual parity using explicit partner names, compact Swedish cover dates, and state-specific CTAs.

Reference: "Item 24 decisions" cover CTAs, compact date, explicit partner fields, and close-parity acceptance bar.

## Acceptance criteria

- [x] The opened/no-answer cover renders explicit partner names from `partner_one_name` and `partner_two_name`, or placeholders when either is blank.
- [x] The cover date renders as compact Swedish day/month plus separate time, for example `26 sept` and `kl. 16:30`.
- [x] The opened/no-answer primary CTA opens the Details panel.
- [x] Saved-answer cover states show the saved RSVP treatment and use a primary CTA that opens OSA for update/edit.
- [x] Visual output is close to the `Opened — no answer yet` and saved-answer/edit references, with intentional differences documented in the PR.
- [x] Details and OSA internals are not restyled beyond what is required to sit inside the shell.

## Blocked by

- Blocked by `issues/001-explicit-partner-name-settings.md`
- Blocked by `issues/002-sync-production-partner-name-fields.md`
- Blocked by `issues/006-one-panel-swipe-hash-invite-shell.md`

## PRD sections addressed

- Item 24 decisions: cover CTAs, compact date, explicit partner fields, close visual parity
