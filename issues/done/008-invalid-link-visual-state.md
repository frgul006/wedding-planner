## Parent PRD

`docs/prd/invite-visual-parity-execution-plan.md`

## Type

AFK

## What to build

Match the Brevkort invalid-link state with safe wedding fallback contact details when available and a generic fallback when no wedding contact can be loaded.

Reference: "Item 24 decisions" invalid-link state.

## Acceptance criteria

- [x] Missing, bad, inactive/invalidated, or archived-guest invite tokens render the invalid-link screen without leaking guest-specific data.
- [x] The invalid-link screen uses configured/default wedding support contact details when available.
- [x] A safe generic fallback renders when no support contact can be loaded.
- [x] The state visually matches `Ogiltig länk` at close parity, with intentional differences documented in the PR.
- [x] Existing invalid-invite smoke tests and guest-navigation cookie safety tests continue to pass.

## Blocked by

- Blocked by `issues/006-one-panel-swipe-hash-invite-shell.md`

## PRD sections addressed

- Item 24 decisions: invalid-link fallback contact and close visual parity
