## Parent PRD

`docs/prd/invite-visual-parity-execution-plan.md`

## Type

HITL

## What to build

Complete a human visual review of shell/cover/invalid/saved-answer screenshots against the extracted invite references, and document intentional differences rather than requiring strict pixel-perfect parity.

Reference: "Item 24 decisions" close-parity acceptance bar and "Item 27 decisions" screenshot artifacts.

## Acceptance criteria

- [x] Screenshot artifacts from the visual QA harness are available for the relevant shell, cover, invalid-link, and saved-answer states.
- [x] A human reviewer compares those artifacts against the target references for `Ogiltig länk`, `Opened — no answer yet`, and saved-answer/edit cover states.
- [x] Intentional visual differences are documented in the relevant PR body or docs.
- [x] Any unintentional blockers are filed or fixed before marking item 24 visually complete.
- [x] The review does not expand scope into Details or OSA internals, which remain owned by items 25 and 26.

## Blocked by

- Unblocked by `issues/done/004-visual-screenshot-harness.md`
- Unblocked by `issues/done/006-one-panel-swipe-hash-invite-shell.md`
- Unblocked by `issues/done/007-cover-and-saved-answer-visual-states.md`
- Unblocked by `issues/done/008-invalid-link-visual-state.md`

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

Remaining HITL scope from this pass was completed in the final review below.

### 2026-05-16 final shell/cover/invalid/saved-answer HITL sign-off

Human review compared regenerated visual QA artifacts against the extracted references for:

- `Ogiltig länk`
- `Opened — no answer yet`
- saved-answer/edit cover states for `Ja`, `Nej`, and `Kanske`

Focused blockers fixed during the HITL pass:

- Invalid-link top ornament now uses the heart/leaf `❦` ornament instead of an ampersand.
- Valid invite panel mark now renders `F & M · 01/03` instead of compact `FM · 01/03`.
- The cover card now uses the full 390 px artboard rhythm: wider card, tighter vertical content, lighter partner-name display weight, taller CTA, and arrow controls aligned near the reference baseline.
- Saved-answer strips now keep `Ja`/`Nej`/`Kanske` response copy readable on one line, with the CTA and bottom arrows aligned to the reviewed shell.
- The visual QA viewport now captures `390×1080` artifacts so shell, CTA, hint, and arrow controls are visible in the official screenshots.

Intentional differences accepted in review:

- Fixture guest labels use deterministic local names such as `Visual Fixture Updates`, `Visual Fixture Plus One`, `Visual Fixture RSVP Nej`, and `Visual Fixture RSVP Kanske` instead of the reference `Ada Lovelace`.
- Invalid-link support contact uses configured local fixture data (`Fredrik & Matilda`, `osa@example.com`) rather than the static reference email.
- Invalid-link footer intentionally omits wedding date/event logistics and only shows the safe couple mark, so invalid tokens do not expose event details.
- Local screenshots may use available system fallback display fonts; the accepted bar is close visual parity, not strict pixel-perfect matching.
- Details and OSA internals were not visually signed off in this issue and remain scoped to items 25 and 26.
- Generated comparison/contact-sheet images are local review artifacts under ignored Playwright output directories and are not committed as baselines.

Validation during this HITL pass:

- `pnpm test:e2e e2e/invite-cover.spec.ts e2e/invite-invalid-link.spec.ts e2e/invite-shell.spec.ts`
- `pnpm test:e2e e2e/invite-visual-qa.spec.ts`
- `pnpm run build`
- `pnpm run lint` (existing `@next/next/no-img-element` warnings only)
- `pnpm run test:e2e`
- `playwright-cli snapshot` for `/invite/visual-updates-published#inbjudan` at `390×1080`

## PRD sections addressed

- Item 24 decisions: close visual parity plus documented intentional differences
- Item 27 decisions: screenshot artifacts for visual review
