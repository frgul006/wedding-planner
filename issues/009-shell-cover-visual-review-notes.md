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

## HITL review notes

### 2026-05-16 cover ornament/date feedback

Human review compared the current opened/no-answer cover screenshot against the extracted cover reference and flagged these mismatches:

- The top cover ornament used an ampersand; it should use the heart/leaf ornament shown in the reference.
- The bottom ornament used the heart/leaf ornament; it should use the flower ornament from the reference.
- The compact date month (`sept`) should use a warmer/lighter tint than the day number.
- The ampersand between partner names should use a more decorative/script-like font treatment than the partner-name display type.

Addressed in PR #62 / commit `da44587`:

- Top ornament changed to `❦` and bottom ornament changed to `❀`.
- Partner-name ampersand now uses the shared `brevkort-ornament` font stack.
- Cover date day/month render as separate spans so the month can use `text-invite-walnut` while the day stays ink.
- `e2e/invite-cover.spec.ts` asserts the top and bottom ornaments are present.

Validation after this feedback:

- `pnpm run build`
- `pnpm run lint` (existing `@next/next/no-img-element` warnings only)
- `PORT=3101 pnpm run test:e2e`
- `playwright-cli snapshot` for `/invite/visual-updates-published#inbjudan`

Remaining HITL scope: final sign-off still needs reviewer confirmation across invalid-link and saved-answer/edit cover artifacts before checking off this issue as complete.

## PRD sections addressed

- Item 24 decisions: close visual parity plus documented intentional differences
- Item 27 decisions: screenshot artifacts for visual review
