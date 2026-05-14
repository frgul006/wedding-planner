# Deployment environments

This project is deployed on Vercel and uses Supabase for application data, auth, and storage.

## Current Vercel/Supabase wiring

As of 2026-05-11:

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

No Vercel Preview-only Supabase variables, branch-specific Supabase overrides, Vercel marketplace integration resources, or Supabase preview branches were found during the 2026-05-11 check.

Therefore, Vercel branch preview deployments currently connect to the same Supabase project/database as production unless the Vercel environment configuration is changed later.

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

Expected state on 2026-05-11: no Supabase preview branches.

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

Look for the Supabase variables. On 2026-05-11 each Supabase var had:

```json
"target": ["preview", "production"]
```

Check for branch-specific Preview overrides:

```bash
vercel env list preview <git-branch-name> --scope mjaox-wedding-planner --format json
```

Expected state on 2026-05-11 for checked branches: no branch-specific Supabase env vars.

Check Vercel marketplace resources/integrations:

```bash
vercel integration list wedding-planner --scope mjaox-wedding-planner
vercel integration installations --scope mjaox-wedding-planner
```

Expected state on 2026-05-11: no resources/installations.

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

Compare the returned `supabaseUrl` between production and the preview deployment. On 2026-05-11 both returned:

```json
"supabaseUrl": "https://wakdmxadoruqsstbokan.supabase.co"
```

Do not print or commit Supabase keys while debugging. The URL/project ref is enough to identify which Supabase project a deployment is using.
