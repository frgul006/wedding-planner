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
pnpm dev
```

Open http://localhost:3000.

For local Supabase setup, seed data, and testing notes, see [`docs/local-development.md`](docs/local-development.md).

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
- [`docs/admin-auth.md`](docs/admin-auth.md) - admin authentication
- [`docs/admin-guests.md`](docs/admin-guests.md) - guest management
- [`e2e/README.md`](e2e/README.md) - end-to-end test notes
