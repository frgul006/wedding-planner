# Invite visual fixtures

`pnpm seed:local` creates deterministic invite visual fixtures for local QA and follow-up visual specs. The fixture data lives in [`e2e/fixtures/invite-visual-fixtures.json`](../e2e/fixtures/invite-visual-fixtures.json), and the Playwright helper in [`e2e/support/invite-visual-fixtures.ts`](../e2e/support/invite-visual-fixtures.ts) can reset/reseed only these fixture guest/update rows.

Run or refresh them with:

```bash
pnpm seed:local
```

Local URLs:

| State | URL |
| --- | --- |
| RSVP `Nej` saved-answer/edit | `http://localhost:3000/invite/visual-rsvp-no-saved#osa` |
| RSVP `Kanske` saved-answer/edit | `http://localhost:3000/invite/visual-rsvp-maybe-saved#osa` |
| +1-expanded RSVP with named +1 | `http://localhost:3000/invite/visual-rsvp-plus-one-expanded#osa` |
| Details panel with published update | `http://localhost:3000/invite/visual-updates-published#detaljer` |

The published update fixture is global wedding data, so it can appear on any valid seeded invite page. Tests that need a blank updates feed should create their own isolated wedding/update setup instead of relying on the default local seed.

## Visual QA screenshots

Run the current visual QA harness with:

```bash
pnpm test:e2e e2e/invite-visual-qa.spec.ts
```

The spec navigates every fixture above, performs lightweight role/content assertions, and writes screenshots under `test-results/e2e/**/invite-visual-qa/*.png`. The same screenshots are attached to the Playwright HTML report (`pnpm exec playwright show-report`) and uploaded from CI as the `invite-visual-qa-screenshots` artifact on successful E2E runs. Generated captures stay in ignored Playwright output directories; do not commit them as baselines unless a later PR explicitly promotes that workflow.
