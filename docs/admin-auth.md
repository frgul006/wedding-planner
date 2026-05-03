# Admin authentication

Admin authentication uses Supabase Auth. We do not store or verify admin passwords in application tables.

## Current implementation

Routes:

- `/admin/login` - login page
- `/admin` - protected admin dashboard placeholder

Files:

- `app/admin/login/page.tsx` - login page shell
- `app/admin/login/login-form.tsx` - client form with `useActionState`
- `app/admin/login/actions.ts` - server actions for sign in/sign out
- `app/admin/page.tsx` - protected admin dashboard placeholder
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
- Authenticated users visiting `/admin/login` redirect to `/admin`.
- Server actions still verify auth where needed; proxy is not the only authorization layer.

## Local admin user

For local development, create an admin user in Supabase Studio:

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
5. Use that email/password at:

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
- Decide whether any Supabase Auth user can be an admin or whether admin access requires a profile/role table.
- Keep admin authorization checks in server actions and route handlers, not only in proxy.
