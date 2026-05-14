# Local development

This project is a Next.js App Router app deployed on Vercel at:

- Production: https://wedding-planner-gamma-lovat.vercel.app/

For deployed Vercel/Supabase environment mapping, see [`deployment-environments.md`](deployment-environments.md).

## Current stack

- Node.js: 22.x locally
- Package manager: pnpm 10.x
- Next.js: 16.2.4
- React: 19.2.4
- Supabase CLI: installed locally on the machine
- Playwright CLI wrapper: `playwright-cli`
- Typed linting: `oxlint` with type-aware rules via `oxlint-tsgolint`

## Prerequisites

- Node.js 20.9+; this machine currently uses Node 22.
- pnpm; this repo declares pnpm in `package.json`.
- Docker Desktop running before starting local Supabase.
- Supabase CLI available as `supabase`.
- Playwright CLI wrapper available as `playwright-cli`.

Check tools:

```bash
node -v
pnpm -v
supabase --version
playwright-cli --version
docker info
```

If `docker info` says it cannot connect to the Docker daemon, open/start Docker Desktop first.

## Install dependencies

```bash
pnpm install
```

## Run the Next.js app locally

```bash
pnpm dev
```

Expected local URL:

- http://localhost:3000

The dev server uses Next.js 16 with Turbopack by default.

Useful checks:

```bash
curl -I http://localhost:3000
pnpm lint # ESLint plus type-aware oxlint checks
pnpm build
```

## Supabase local development

This repo has been initialized with Supabase CLI config in:

- `supabase/config.toml`

Start local Supabase:

```bash
pnpm supabase:start
```

This requires Docker Desktop to be running. When startup succeeds, Supabase prints local URLs and keys. Copy the values into `.env.local` using `.env.example` as the template:

```bash
cp .env.example .env.local
pnpm supabase:status
```

Expected default local services from `supabase/config.toml`:

- API: http://127.0.0.1:54321
- DB: postgresql://postgres:postgres@127.0.0.1:54322/postgres
- Studio: http://127.0.0.1:54323
- Mailpit email UI: http://127.0.0.1:54324

Stop Supabase:

```bash
pnpm supabase:stop
```

Reset local DB after migrations/seeds exist:

```bash
supabase db reset
```

The SQL seed creates a default wedding row with id:

```txt
00000000-0000-0000-0000-000000000001
```

For faster iteration on a fresh local database, seed example auth/admin/guest data:

```bash
pnpm seed:local
```

This creates/updates:

- example wedding: `Fredrik <3 Matilda`
- admin user: `admin@example.com`
- admin password: `password123456`
- matching `admin_profiles` row
- a few example guests
- stable local RSVP test links for first-time and existing-response flows

Then log in at `http://localhost:3000/admin/login`.

Admin login requires both a Supabase Auth user and a matching `admin_profiles` row. See `docs/admin-auth.md`.

## Environment variables

Create local env file:

```bash
cp .env.example .env.local
```

Variables planned for the app:

```bash
NEXT_PUBLIC_SUPABASE_URL=http://127.0.0.1:54321
NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=...
SUPABASE_SECRET_KEY=...
NEXT_PUBLIC_SITE_URL=http://localhost:3000
WEDDING_ID=00000000-0000-0000-0000-000000000001
```

QR hub notes:

- `NEXT_PUBLIC_SITE_URL` is optional locally, but helps generated QR links use a stable public origin. Vercel deployments can fall back to `VERCEL_URL` when `NEXT_PUBLIC_SITE_URL` is not set.
- `WEDDING_ID` selects the wedding row used by the public shared `/wedding-hub`. It is optional only while the database has exactly one wedding row; set it when multiple wedding rows may exist.

Rules:

- `NEXT_PUBLIC_*` values are safe to expose to browser code.
- `SUPABASE_SECRET_KEY` and `WEDDING_ID` are server-only and must never be imported into client components.
- `.env.local` is ignored by git.

## Browser navigation with `playwright-cli`

The machine has `playwright-cli`, which is different from the standard `npx playwright` command. Use it directly:

```bash
playwright-cli --help
```

Open the local app:

```bash
playwright-cli open http://localhost:3000
```

If a browser is already open, navigate it:

```bash
playwright-cli goto http://localhost:3000
```

Inspect the current page accessibility snapshot:

```bash
playwright-cli snapshot
```

Take a screenshot:

```bash
playwright-cli screenshot
```

View console messages:

```bash
playwright-cli console
```

List network requests:

```bash
playwright-cli requests
```

Close browser session:

```bash
playwright-cli close
```

If sessions get stuck:

```bash
playwright-cli list
playwright-cli close-all
# or, for stale/zombie browser processes
playwright-cli kill-all
```

## Automated Playwright e2e regression tests

The automated e2e suite uses Playwright Test. Test files and helpers live in `e2e/`.

Prepare local data before running the suite:

```bash
pnpm supabase:start
supabase db reset
pnpm seed:local
```

Run the suite:

```bash
pnpm test:e2e
```

Useful variants:

```bash
pnpm test:e2e:headed
pnpm test:e2e:ui
```

By default, Playwright starts the Next.js dev server on `http://127.0.0.1:3000`. Set `PLAYWRIGHT_SKIP_WEB_SERVER=1` and `PLAYWRIGHT_BASE_URL` to target an already-running app.

In CI, the `E2E regression` GitHub Actions job starts local Supabase, writes `.env.local` from `supabase status -o env`, resets/seeds the database, runs `pnpm test:e2e`, and uploads Playwright artifacts on failure.

## How the coding agent can spin up local dev

From repo root:

```bash
pnpm install
pnpm dev
```

Then verify with:

```bash
curl -I http://localhost:3000
curl http://localhost:3000/api/health/supabase
playwright-cli open http://localhost:3000
playwright-cli snapshot
```

For Supabase, only after Docker Desktop is running:

```bash
pnpm supabase:start
pnpm supabase:status
```

## Current discovery notes

- `pnpm dev` starts successfully at http://localhost:3000.
- `playwright-cli open http://localhost:3000` can navigate to the local app.
- Supabase CLI is initialized in `supabase/config.toml`.
- `pnpm supabase:start` starts local Supabase when Docker Desktop is running.
- Local Supabase status is available with `pnpm supabase:status`.
- The app has a temporary Supabase health endpoint at `/api/health/supabase`.
- Admin auth docs are in `docs/admin-auth.md`.
- The public homepage is still the default Vercel/Next.js template page.
