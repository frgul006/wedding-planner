# Deployment environments

This project is deployed on Vercel and uses Supabase for application data, auth, and storage.

## Current Vercel/Supabase wiring

As of 2026-05-14:

- Vercel scope: `mjaox-wedding-planner`
- Vercel project: `wedding-planner`
- Production URL: https://wedding-planner-gamma-lovat.vercel.app/
- Supabase project name: `wedding-planner`
- Supabase project ref: `wakdmxadoruqsstbokan`
- Supabase URL: `https://wakdmxadoruqsstbokan.supabase.co`

Vercel has one set of Supabase environment variables targeting both `preview` and `production`:

- `NEXT_PUBLIC_SUPABASE_URL`
- `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`
- `SUPABASE_SECRET_KEY`

No Vercel Preview-only Supabase variables, branch-specific Supabase overrides, Vercel marketplace integration resources, or Supabase preview branches were found during the 2026-05-14 check.

Therefore, Vercel branch preview deployments currently connect to the same Supabase project/database as production unless the Vercel environment configuration is changed later.

For production migration and bootstrap procedures, see [`production-database.md`](production-database.md).

## Production deployment gate

Vercel's automatic Git deployment for the `main` branch is intentionally skipped by the [`vercel.json`](../vercel.json) ignore command. The [`CI` workflow](../.github/workflows/ci.yml) deploys production instead, and only when a push to `main` has completed both required jobs successfully:

- `lint-and-build`, which runs `pnpm lint` and `pnpm build`
- `e2e`, which runs the Playwright regression suite on every non-PR event, including `main` pushes

Non-`main` Vercel Git deployments are not skipped by the ignore command, so branch Preview deployments keep their normal Vercel behavior.

The production deploy job runs in the GitHub `Production` environment and requires these environment secrets:

- `VERCEL_TOKEN`
- `VERCEL_ORG_ID`
- `VERCEL_PROJECT_ID`

Create `VERCEL_TOKEN` in Vercel account settings. To find the org/project IDs, run `vercel link --yes --scope mjaox-wedding-planner --project wedding-planner` locally and copy the `orgId` and `projectId` values from `.vercel/project.json`; `.vercel/` is gitignored and should not be committed. Add all three values (`VERCEL_TOKEN`, `VERCEL_ORG_ID`, and `VERCEL_PROJECT_ID`) as secrets on the GitHub repository's `Production` environment, not only as repository-level secrets.

The deploy job installs the latest Vercel CLI, pulls the Vercel production environment, builds with `vercel build --prod`, then deploys the prebuilt artifact with `vercel deploy --prebuilt --prod`. If lint, build, or e2e fails, the deploy job does not run and Vercel production is not updated.

## Captured evidence from the 2026-05-14 check

| Check | Command | Result |
| --- | --- | --- |
| Supabase project inventory | `supabase projects list` | Found `wedding-planner` with ref `wakdmxadoruqsstbokan`. |
| Supabase preview branches | `supabase branches list --project-ref wakdmxadoruqsstbokan` | Returned no branches. |
| Vercel project inventory | `vercel project list --scope mjaox-wedding-planner` | Found the `wedding-planner` project. |
| Vercel env targets | `vercel env list --scope mjaox-wedding-planner --format json` | Each Supabase env var was a single entry targeting both `preview` and `production`. |
| Branch-specific Preview env overrides | `vercel env list preview <git-branch-name> --scope mjaox-wedding-planner --format json` | Checked active preview branches returned no branch-specific Supabase env vars. |
| Vercel marketplace integrations | `vercel integration list wedding-planner --scope mjaox-wedding-planner` and `vercel integration installations --scope mjaox-wedding-planner` | Returned no resources/installations. |
| Runtime project URL | `/api/health/supabase` on production and a protected preview via `vercel curl` | Both returned `https://wakdmxadoruqsstbokan.supabase.co`. |

The CLI outputs intentionally do not include Supabase keys. Keep it that way: project URL/ref is sufficient evidence for database routing.

## Why previews do not get separate databases automatically

The application creates Supabase clients from environment variables only:

- browser/server clients use `NEXT_PUBLIC_SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`
- admin/server clients use `NEXT_PUBLIC_SUPABASE_URL` and `SUPABASE_SECRET_KEY`

Vercel Preview deployments do not create independent Supabase projects by themselves. A preview deployment gets whatever values Vercel provides for the Preview environment. Separate preview databases would require explicit setup, for example:

- separate Vercel Preview env vars pointing at a staging Supabase project,
- branch-specific Vercel env vars pointing at branch/staging databases, or
- Supabase preview branches wired into Vercel.

## How to re-check this

These commands are safe to run because they list project metadata and env var names/targets, not secret values.

### Supabase CLI

List Supabase projects and identify the project ref:

```bash
supabase projects list
```

Check whether the Supabase project has preview branches:

```bash
supabase branches list --project-ref wakdmxadoruqsstbokan
```

Expected state on 2026-05-14: no Supabase preview branches.

### Vercel CLI

Confirm the Vercel project:

```bash
vercel project list --scope mjaox-wedding-planner
vercel project inspect wedding-planner --scope mjaox-wedding-planner
```

List Vercel env vars and targets:

```bash
vercel env list --scope mjaox-wedding-planner --format json
```

Look for the Supabase variables. On 2026-05-14 each Supabase var had:

```json
"target": ["preview", "production"]
```

Check for branch-specific Preview overrides:

```bash
vercel env list preview <git-branch-name> --scope mjaox-wedding-planner --format json
```

Expected state on 2026-05-14 for checked branches: no branch-specific Supabase env vars.

Check Vercel marketplace resources/integrations:

```bash
vercel integration list wedding-planner --scope mjaox-wedding-planner
vercel integration installations --scope mjaox-wedding-planner
```

Expected state on 2026-05-14: no resources/installations.

### Runtime verification

The app has a diagnostic Supabase health endpoint:

```txt
/api/health/supabase
```

Production can be checked with:

```bash
curl https://wedding-planner-gamma-lovat.vercel.app/api/health/supabase
```

For protected Preview deployments, use Vercel CLI so the request can include a deployment-protection bypass:

```bash
vercel curl /api/health/supabase \
  --deployment https://<preview-deployment>.vercel.app \
  --scope mjaox-wedding-planner
```

Compare the returned `supabaseUrl` between production and the preview deployment. On 2026-05-14 both returned:

```json
"supabaseUrl": "https://wakdmxadoruqsstbokan.supabase.co"
```

Do not print or commit Supabase keys while debugging. The URL/project ref is enough to identify which Supabase project a deployment is using.
