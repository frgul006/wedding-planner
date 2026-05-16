## Parent PRD

`docs/prd/invite-visual-parity-execution-plan.md`

## Type

AFK

## What to build

Extend the visual QA harness with Playwright-controlled transient OSA states for submitting and save-error screenshots, using route interception/mocks rather than production fixture flags.

Reference: "Item 27 decisions" transient state mocks.

## Acceptance criteria

- [x] The visual QA spec can capture an OSA submitting state by delaying the RSVP submission request.
- [x] The submitting state preserves visible form values and shows disabled/progress copy.
- [x] The visual QA spec can capture an OSA save-error state by mocking or forcing a failed submission path.
- [x] The save-error state preserves values and shows the expected error banner/copy.
- [x] No production query flags or test-only rendering branches are added for these transient states.

## Blocked by

- Blocked by `issues/004-visual-screenshot-harness.md`

## PRD sections addressed

- Item 27 decisions: Playwright route interception/mocks for transient submitting and save-error states

## Implementation notes

- Extended `e2e/invite-visual-qa.spec.ts` with `rsvp-submitting-osa.png` and `rsvp-save-error-osa.png` captures derived from the seeded RSVP `Kanske` fixture.
- Delayed the next intercepted invite POST to hold the form in the disabled `Skickar…` state while preserving edited phone and meal values.
- Forced the save-error capture by invalidating the fixture token immediately before the intercepted invite POST and asserting the expected `Kunde inte spara` banner plus preserved values.
- Kept all transient behavior in Playwright/support helpers; no production query flags or test-only rendering branches were added.

## Validation

- `pnpm run build`
- `pnpm run lint` (existing `@next/next/no-img-element` warnings only)
- `pnpm run test:e2e`
- `playwright-cli snapshot` for the RSVP `Kanske` save-error flow at `http://127.0.0.1:3000/invite/visual-rsvp-maybe-saved#osa`
