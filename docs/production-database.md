# Production database operations

Production uses the Supabase project documented in [`deployment-environments.md`](deployment-environments.md):

- Project name: `wedding-planner`
- Project ref: `wakdmxadoruqsstbokan`
- URL: `https://wakdmxadoruqsstbokan.supabase.co`

Treat every command with `--linked` as a production command once the local Supabase CLI project is linked to `wakdmxadoruqsstbokan`.

## Current production state

As of 2026-05-14:

- all migrations in `supabase/migrations/` through `20260511120000_photo_upload_thumbnails.sql` have been applied to production
- production has one wedding row with id `00000000-0000-0000-0000-000000000001`
- production has one active admin profile for `frgul006@hotmail.com`
- production has no guest rows
- Vercel has `WEDDING_ID=00000000-0000-0000-0000-000000000001` configured for Production and Preview environments

Do not commit or document production passwords, Supabase service keys, or Vercel secret values.

## Migration workflow for future iterations

Use migrations for schema changes, RLS policies, functions, storage buckets, and other database structure. Do not hand-edit production schema in the Supabase dashboard unless you immediately convert the change into a migration.

From a clean checkout on the latest `main`:

```bash
git fetch origin main
git switch main
git pull --ff-only origin main
supabase link --project-ref wakdmxadoruqsstbokan
```

Inspect migration state:

```bash
supabase migration list --linked
```

Always dry-run first:

```bash
supabase db push --linked --dry-run
```

If the dry-run lists only the migrations you expect, apply them:

```bash
supabase db push --linked
```

Verify afterward:

```bash
supabase migration list --linked
curl https://wedding-planner-gamma-lovat.vercel.app/api/health/supabase
```

Optional row-count sanity check:

```bash
supabase db query --linked -o json \
  "select (select count(*)::int from public.weddings) as wedding_count, (select count(*)::int from public.admin_profiles) as admin_profile_count, (select count(*)::int from public.guests) as guest_count;"
```

Rules:

- Never run `supabase db reset` against production.
- Do not use `--include-seed` for normal production migration pushes.
- Keep `supabase/seed.sql` and `scripts/seed-local.mjs` local/dev-oriented unless a production seed has been explicitly reviewed.
- Prefer idempotent migrations (`create table if not exists`, `insert ... on conflict`, safe `alter table` patterns where possible) when adding reference data or storage metadata.
- Take a Supabase backup/snapshot or confirm point-in-time recovery before risky data migrations.

## Production bootstrap

Use `scripts/bootstrap-production.mjs` only for intentional production bootstrapping or first-admin recovery. It is gated by a project-ref confirmation to avoid accidental use.

Minimal first-admin bootstrap:

```bash
CONFIRM_PRODUCTION_PROJECT_REF=wakdmxadoruqsstbokan \
PRODUCTION_ADMIN_EMAIL=person@example.com \
pnpm bootstrap:production
```

This script:

- retrieves the project service-role key through Supabase CLI without printing it
- creates or reuses the Supabase Auth user for `PRODUCTION_ADMIN_EMAIL`
- creates the production wedding row if it is missing; it does not overwrite an existing wedding's settings
- creates/updates the matching `public.admin_profiles` row
- generates and prints a temporary password only when it creates a user or resets an existing user's password
- verifies Supabase Auth sign-in when it sets a password

Useful options/env vars:

```bash
# Required safety confirmation
CONFIRM_PRODUCTION_PROJECT_REF=wakdmxadoruqsstbokan

# Required admin identity
PRODUCTION_ADMIN_EMAIL=person@example.com

# Optional; defaults to the current production project
PRODUCTION_SUPABASE_PROJECT_REF=wakdmxadoruqsstbokan

# Optional; defaults to 00000000-0000-0000-0000-000000000001
PRODUCTION_WEDDING_ID=00000000-0000-0000-0000-000000000001

# Optional; defaults to Fredrik <3 Matilda
PRODUCTION_WEDDING_NAME="Fredrik <3 Matilda"

# Optional; defaults to admin email
PRODUCTION_ADMIN_DISPLAY_NAME="Fredrik"

# Optional; if omitted, the script generates a temporary password when needed
PRODUCTION_ADMIN_PASSWORD="temporary-password"

# Optional; reset password for an existing Auth user
PRODUCTION_ADMIN_RESET_PASSWORD=1
```

Reset an existing first-admin password:

```bash
CONFIRM_PRODUCTION_PROJECT_REF=wakdmxadoruqsstbokan \
PRODUCTION_ADMIN_EMAIL=person@example.com \
PRODUCTION_ADMIN_RESET_PASSWORD=1 \
pnpm bootstrap:production
```

The script intentionally does not create sample guests, invite tokens, or RSVP rows in production.

## Production data vs local seed data

Use these buckets for data changes:

- Local/demo data: `supabase/seed.sql` and `scripts/seed-local.mjs`.
- Production schema and storage metadata: migrations in `supabase/migrations/`.
- One-time production bootstrap/recovery: `scripts/bootstrap-production.mjs`.
- Real wedding content after admin access exists: admin UI (`/admin/settings`, `/admin/guests`, `/admin/updates`, `/admin/messages`) or a reviewed one-off import script.

If a future feature requires production reference data, prefer a dedicated idempotent migration or a separate reviewed script rather than adding it to the local seed.

## Vercel environment alignment

`WEDDING_ID` should match the production wedding row:

```txt
00000000-0000-0000-0000-000000000001
```

Check Vercel env targets without printing values:

```bash
vercel env list --scope mjaox-wedding-planner --format json
```

If `WEDDING_ID` needs to be recreated, add it to Production and Preview. The Vercel CLI may prompt for the Preview git branch; leave the branch prompt empty to apply to all Preview branches.

Environment changes usually require a redeploy before an existing deployment sees the new value. The app can still resolve the public wedding hub without `WEDDING_ID` while exactly one wedding row exists, but keeping `WEDDING_ID` configured avoids ambiguity later.
