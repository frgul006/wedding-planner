# E2E regression tests

This directory contains the Playwright Test foundation for guest-facing and admin-facing regression flows. Smoke specs verify the harness and seeded local data, while focused specs cover admin guests, RSVP, wedding settings, and updates.

## Local prerequisites

1. Install dependencies:

   ```bash
   pnpm install
   ```

2. Start local Supabase and copy the printed local keys into `.env.local` if needed:

   ```bash
   pnpm supabase:start
   pnpm supabase:status
   ```

3. Reset and seed deterministic test data:

   ```bash
   supabase db reset
   pnpm seed:local
   ```

## Running tests

```bash
pnpm test:e2e
```

Useful variants:

```bash
pnpm test:e2e:headed
pnpm test:e2e:ui
```

The Playwright config starts the Next.js dev server on `http://127.0.0.1:3000` by default. Override behavior with:

- `PLAYWRIGHT_BASE_URL` — target an already-running app.
- `PLAYWRIGHT_SKIP_WEB_SERVER=1` — do not start a web server from Playwright.
- `PLAYWRIGHT_WEB_SERVER_COMMAND` — replace the default `pnpm exec next dev ...` command.
- `PORT` — change the default local port.

## CI

GitHub Actions runs the same suite in the `E2E regression` job. The job installs the Supabase CLI, starts local Supabase, writes `.env.local` from `supabase status -o env`, resets/seeds the local database, runs `pnpm test:e2e`, and uploads `playwright-report/` plus `test-results/` when the suite fails.

## Seeded data helpers

Shared helpers in `e2e/support` expose the deterministic local seed values from `scripts/seed-local.mjs`, including:

- admin login: `admin@example.com / password123456`
- first-time RSVP token: `local-ada-first-time-rsvp`
- existing RSVP token: `local-alan-existing-rsvp`
- invite visual fixtures: `visual-rsvp-no-saved`, `visual-rsvp-maybe-saved`, `visual-rsvp-plus-one-expanded`, and `visual-updates-published` (see [`docs/invite-visual-fixtures.md`](../docs/invite-visual-fixtures.md))

Future specs should prefer accessible locators (`getByRole`, `getByLabel`, headings, button names). Add app selectors only when a row-level control cannot be targeted reliably by accessible name. Use the shared cleanup fixtures in `e2e/support/fixtures.ts` and `uniqueE2eValue()` for generated test data. For deterministic invite visual states, use `seedInviteVisualFixtures()` / `resetInviteVisualFixtures()` from `e2e/support/invite-visual-fixtures.ts`; those helpers only touch the fixture guest IDs and fixture update IDs.
