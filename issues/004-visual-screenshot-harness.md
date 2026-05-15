## Parent PRD

`docs/prd/invite-visual-parity-execution-plan.md`

## Type

AFK

## What to build

Add Playwright visual QA specs that navigate the deterministic invite visual fixtures, assert key accessibility/content, and attach screenshots as CI artifacts without committing generated screenshot baselines.

Reference: "Item 27 decisions" screenshot harness and CI artifact strategy.

## Acceptance criteria

- [ ] A Playwright visual QA spec visits every stable visual fixture from `issues/003-stable-invite-visual-fixtures.md`.
- [ ] Each visual state has lightweight content/accessibility assertions before screenshot capture.
- [ ] Screenshots are attached to Playwright test artifacts in default E2E CI.
- [ ] CI uploads the visual screenshot artifacts for successful visual QA runs, not only on failures.
- [ ] Generated screenshots remain ignored/uncommitted unless a later PR intentionally promotes baselines.
- [ ] Local instructions document how to run the visual QA spec and locate artifacts.

## Blocked by

- Blocked by `issues/003-stable-invite-visual-fixtures.md`

## PRD sections addressed

- Item 27 decisions: visual specs in default E2E CI
- Item 27 decisions: screenshots as artifacts, no committed generated baselines
