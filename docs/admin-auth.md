# Admin authentication

Admin authentication uses Supabase Auth. We do not store or verify admin passwords in application tables.

## Current implementation

Routes:

- `/admin/login` - login page
- `/admin` - protected admin dashboard placeholder
- `/admin/unauthorized` - signed-in Supabase user without app admin access

Files:

- `app/admin/login/page.tsx` - login page shell
- `app/admin/login/login-form.tsx` - client form with `useActionState`
- `app/admin/login/actions.ts` - server actions for sign in/sign out
- `app/admin/page.tsx` - protected admin dashboard placeholder
- `app/admin/unauthorized/page.tsx` - unauthorized admin fallback
- `proxy.ts` - route guard for `/admin/:path*`
- `lib/supabase/server.ts` - server-side Supabase clients
- `lib/supabase/client.ts` - browser Supabase client
- `lib/supabase/proxy.ts` - Supabase session refresh for Next.js Proxy

## Route guard behavior

Next.js 16 uses `proxy.ts`; the older `middleware.ts` convention is deprecated.

The proxy matcher protects:

```ts
matcher: ["/admin/:path*"]
```

Rules:

- Unauthenticated `/admin/*` requests redirect to `/admin/login?next=...`, preserving the original path and query string.
- Authenticated users need an active `admin_profiles` row to access admin pages.
- Authenticated users without an active `admin_profiles` row redirect to `/admin/unauthorized`.
- Authenticated admins visiting `/admin/login` redirect to `/admin`.
- Server actions still verify auth where needed; proxy is not the only authorization layer.

## Local admin user

For fastest local setup after `supabase db reset`, run:

```bash
pnpm seed:local
```

This creates an example admin user:

```txt
admin@example.com / password123456
```

Manual setup is also possible. Create a Supabase Auth user and then grant app admin access with an `admin_profiles` row:

1. Start Supabase:

   ```bash
   pnpm supabase:start
   ```

2. Open Studio:

   ```txt
   http://127.0.0.1:54323
   ```

3. Go to Authentication → Users.
4. Create a user with email/password.
5. Copy the created user's UUID.
6. Go to SQL Editor and create an admin profile for the seeded local wedding:

   ```sql
   insert into public.admin_profiles (id, wedding_id, email, display_name)
   values (
     '<auth-user-uuid>',
     '00000000-0000-0000-0000-000000000001',
     '<admin-email>',
     '<admin-name>'
   );
   ```

7. Use that email/password at:

   ```txt
   http://localhost:3000/admin/login
   ```

## Environment variables

Local `.env.local` should contain:

```bash
NEXT_PUBLIC_SUPABASE_URL=http://127.0.0.1:54321
NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=...
SUPABASE_SECRET_KEY=...
```

`SUPABASE_SECRET_KEY` is server-only. Never import it into client components.

## Production notes

Before production use:

- Set Supabase URL and keys in Vercel environment variables. The app does not require these variables at build-time, but admin/auth routes need them at runtime.
- Create the production wedding row and first `admin_profiles` row after the migration is applied. See [`production-database.md`](production-database.md) for the guarded bootstrap script and migration workflow.
- Keep admin authorization checks in server actions and route handlers, not only in proxy.
