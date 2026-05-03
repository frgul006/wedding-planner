# Invite tokens

Private guest invite links are backed by `public.invite_tokens`.

## Security model

- Raw invite tokens are generated server-side with 32 random bytes and encoded with URL-safe base64.
- Only a SHA-256 hash of the raw token is stored in the database.
- `token_hash` is globally unique.
- A partial unique index allows only one active token per guest.
- Regenerating a link invalidates the previous active token before creating a new active token.
- Raw links are shown in the admin UI only in the immediate generate/regenerate result and are not stored client-side by the app.

## Admin behavior

On `/admin/guests`:

- Guests without an active token show **Generate invite link**.
- Guests with an active token show **Regenerate invite link**.
- After generation, the raw `/invite/:token` URL is displayed with a copy button.
- Reloading the page hides the raw URL; admins must regenerate if they need a new copy.

## Public validation

`/invite/[token]` validates a token by hashing the path token and looking up an active `invite_tokens` row.

- Valid active token: displays a safe placeholder with the guest name.
- Invalid or inactive token: displays a generic invalid-link message without guest data.

## Local validation

```bash
supabase db reset
pnpm seed:local
pnpm lint
pnpm build
```

Then log in as the seeded admin, generate a link for a seeded guest, visit it, regenerate, and verify the old link becomes invalid while the new link remains valid.
