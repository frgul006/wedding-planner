# Wedding Planner

A Next.js wedding planning app with Supabase-backed admin tools for managing guests, RSVPs, messages, wedding settings, and updates.

Production: https://wedding-planner-gamma-lovat.vercel.app/

## Tech stack

- Next.js 16 / React 19
- TypeScript
- Supabase
- Playwright
- pnpm

## Getting started

```bash
pnpm install
cp .env.example .env.local
pnpm supabase:start
pnpm supabase:status
# Copy the local Supabase URL and keys into .env.local, then:
pnpm seed:local
pnpm dev
```

Open http://localhost:3000.

For detailed local setup, seed data, and testing notes, see [`docs/local-development.md`](docs/local-development.md).

## Useful commands

```bash
pnpm lint
pnpm build
pnpm test:e2e
pnpm supabase:start
pnpm seed:local
```

## Documentation

- [`docs/local-development.md`](docs/local-development.md) - local setup and validation
- [`docs/deployment-environments.md`](docs/deployment-environments.md) - Vercel/Supabase environment mapping
- [`docs/production-database.md`](docs/production-database.md) - production migrations and bootstrap
- [`docs/admin-auth.md`](docs/admin-auth.md) - admin authentication
- [`docs/admin-guests.md`](docs/admin-guests.md) - guest management
- [`docs/admin-photos.md`](docs/admin-photos.md) - photo moderation and export
- [`docs/prd/photo-review-and-export.md`](docs/prd/photo-review-and-export.md) - photo moderation/export PRD
- [`e2e/README.md`](e2e/README.md) - end-to-end test notes
