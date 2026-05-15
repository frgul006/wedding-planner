## Parent PRD

`docs/prd/invite-visual-parity-execution-plan.md`

## Type

AFK

## What to build

After the partner-name prerequisite has merged, apply and verify the production database schema update so production has `partner_one_name` and `partner_two_name` before public invite UI work depends on those columns.

Reference: the agreed operational step after item 23a; this blocks item 24 public UI work only.

## Acceptance criteria

- [ ] The production database has `weddings.partner_one_name` and `weddings.partner_two_name` with the same shape as the merged migration.
- [ ] Verification evidence is recorded locally in the implementation notes or PR body for this issue's PR.
- [ ] No production data is backfilled automatically from `weddings.name`.
- [ ] The app can still load existing production wedding settings after the schema sync.

## Blocked by

- Blocked by `issues/001-explicit-partner-name-settings.md`

## PRD sections addressed

- Delivery sequence: Item 23a must merge before items 24 or 27
- Branch and PR boundaries: item 24 depends on explicit partner names from `main`
