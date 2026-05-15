## Parent PRD

`docs/prd/invite-visual-parity-execution-plan.md`

## Type

AFK

## What to build

Extend the visual QA harness with Playwright-controlled transient OSA states for submitting and save-error screenshots, using route interception/mocks rather than production fixture flags.

Reference: "Item 27 decisions" transient state mocks.

## Acceptance criteria

- [ ] The visual QA spec can capture an OSA submitting state by delaying the RSVP submission request.
- [ ] The submitting state preserves visible form values and shows disabled/progress copy.
- [ ] The visual QA spec can capture an OSA save-error state by mocking or forcing a failed submission path.
- [ ] The save-error state preserves values and shows the expected error banner/copy.
- [ ] No production query flags or test-only rendering branches are added for these transient states.

## Blocked by

- Blocked by `issues/004-visual-screenshot-harness.md`

## PRD sections addressed

- Item 27 decisions: Playwright route interception/mocks for transient submitting and save-error states
