## Parent PRD

`docs/prd/invite-visual-parity-execution-plan.md`

## Type

HITL

## What to build

Complete a human visual review of shell/cover/invalid/saved-answer screenshots against the extracted invite references, and document intentional differences rather than requiring strict pixel-perfect parity.

Reference: "Item 24 decisions" close-parity acceptance bar and "Item 27 decisions" screenshot artifacts.

## Acceptance criteria

- [ ] Screenshot artifacts from the visual QA harness are available for the relevant shell, cover, invalid-link, and saved-answer states.
- [ ] A human reviewer compares those artifacts against the target references for `Ogiltig länk`, `Opened — no answer yet`, and saved-answer/edit cover states.
- [ ] Intentional visual differences are documented in the relevant PR body or docs.
- [ ] Any unintentional blockers are filed or fixed before marking item 24 visually complete.
- [ ] The review does not expand scope into Details or OSA internals, which remain owned by items 25 and 26.

## Blocked by

- Blocked by `issues/004-visual-screenshot-harness.md`
- Blocked by `issues/006-one-panel-swipe-hash-invite-shell.md`
- Blocked by `issues/007-cover-and-saved-answer-visual-states.md`
- Blocked by `issues/008-invalid-link-visual-state.md`

## PRD sections addressed

- Item 24 decisions: close visual parity plus documented intentional differences
- Item 27 decisions: screenshot artifacts for visual review
