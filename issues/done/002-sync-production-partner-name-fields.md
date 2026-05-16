## Parent PRD

`docs/prd/invite-visual-parity-execution-plan.md`

## Type

AFK

## What to build

After the partner-name prerequisite has merged, apply and verify the production database schema update so production has `partner_one_name` and `partner_two_name` before public invite UI work depends on those columns.

Reference: the agreed operational step after item 23a; this blocks item 24 public UI work only.

## Acceptance criteria

- [x] The production database has `weddings.partner_one_name` and `weddings.partner_two_name` with the same shape as the merged migration.
- [x] Verification evidence is recorded locally in the implementation notes or PR body for this issue's PR.
- [x] No production data is backfilled automatically from `weddings.name`.
- [x] The app can still load existing production wedding settings after the schema sync.

## Implementation notes

Completed 2026-05-15 against Supabase project `wakdmxadoruqsstbokan`.

- `supabase migration list --linked` shows remote migration `20260515230000` applied.
- Catalog verification shows `public.weddings.partner_one_name` and `public.weddings.partner_two_name` are nullable `text` columns with no defaults and with comments.
- Production data sanity check returned one wedding row, zero populated partner-name values, and zero rows where either partner column matched `weddings.name`.
- PostgREST settings-shape verification selected the full admin settings column list for production wedding `00000000-0000-0000-0000-000000000001` and returned one row with both new partner fields null.
- Production health check returned `ok: true` from `/api/health/supabase`.

## Blocked by

- Blocked by `issues/001-explicit-partner-name-settings.md`

## PRD sections addressed

- Delivery sequence: Item 23a must merge before items 24 or 27
- Branch and PR boundaries: item 24 depends on explicit partner names from `main`
